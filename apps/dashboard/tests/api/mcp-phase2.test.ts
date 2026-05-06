import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { db } from "../../server/db"
import { projects, projectMembers, reports, reportComments } from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"

beforeAll(() => {
  if (process.env.MCP_ENABLED !== "true") {
    throw new Error("Run integration tests with MCP_ENABLED=true (the dev server too).")
  }
})

afterAll(async () => {
  await truncateDomain()
})

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

interface SetupResult {
  client: Client
  userId: string
  projectId: string
  ticketId: string
}

async function setupOAuth(): Promise<SetupResult> {
  await truncateDomain()
  const userId = await createUser("phase2-mcp@example.com")
  const cookie = await signIn("phase2-mcp@example.com")

  const projectId = crypto.randomUUID()
  await db.insert(projects).values({ id: projectId, name: "Phase 2 Test", createdBy: userId })
  await db.insert(projectMembers).values({ projectId, userId, role: "developer" })

  const ticketId = crypto.randomUUID()
  await db.insert(reports).values({
    id: ticketId,
    projectId,
    title: "Login button does nothing",
    description: "Clicking the **Sign in** button no longer triggers anything",
    status: "open",
    priority: "high",
    tags: ["auth", "frontend"],
    source: "web",
    context: {
      source: "web",
      pageUrl: "https://example.com/login",
      userAgent: "Mozilla/5.0",
      viewport: { w: 1440, h: 900 },
      timestamp: Date.now(),
      cookies: [{ name: "host_session", value: "•••", domain: "example.com" }],
    },
  })
  await db.insert(reportComments).values({
    reportId: ticketId,
    userId,
    body: "Reproduced on Chrome 132",
    source: "dashboard",
  })

  const discovery = await fetch(`${BASE}/.well-known/oauth-authorization-server/api/auth`).then(
    (r) => r.json(),
  )
  const reg = await fetch(discovery.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Phase2 Test Client",
      redirect_uris: [`${BASE}/oauth-test-callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  }).then((r) => r.json())

  const { verifier, challenge } = pkce()
  const authorizeUrl = new URL(discovery.authorization_endpoint)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("client_id", reg.client_id)
  authorizeUrl.searchParams.set("redirect_uri", `${BASE}/oauth-test-callback`)
  authorizeUrl.searchParams.set("scope", "mcp:full")
  authorizeUrl.searchParams.set("code_challenge", challenge)
  authorizeUrl.searchParams.set("code_challenge_method", "S256")
  authorizeUrl.searchParams.set("state", "test-state")
  const authorizeRes = await fetch(authorizeUrl, { headers: { cookie }, redirect: "manual" })
  let location = authorizeRes.headers.get("location") ?? ""
  if (location.includes("/oauth/consent")) {
    const consentLocationUrl = new URL(location, BASE)
    const oauthQuery = consentLocationUrl.search.replace(/^\?/, "")
    const decision = await apiFetch<{ redirectUri: string }>("/api/oauth/consent", {
      method: "POST",
      headers: { cookie },
      body: { oauthQuery, allow: true },
    })
    expect(decision.status).toBe(200)
    location = decision.body.redirectUri
  }
  const code = new URL(location, BASE).searchParams.get("code")
  if (!code) throw new Error("missing code param in redirect")
  const tokenRes = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${BASE}/oauth-test-callback`,
      client_id: reg.client_id,
      code_verifier: verifier,
      resource: `${BASE}/api/mcp`,
    }),
  }).then((r) => r.json())

  const client = new Client({ name: "phase2-test-client", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokenRes.access_token}` } },
  })
  await client.connect(transport)
  return { client, userId, projectId, ticketId }
}

function parseToolText<T>(result: { content?: Array<unknown> }): T {
  const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "null"
  return JSON.parse(text) as T
}

describe("MCP Phase 2 read tools", () => {
  it("repro_list_tickets returns the seeded ticket", async () => {
    const { client, projectId, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_list_tickets",
        arguments: { projectId },
      })
      const parsed = parseToolText<{
        items: Array<{ id: string; title: string; tags: string[] }>
        nextCursor: string | null
      }>(result)
      expect(parsed.items.find((t) => t.id === ticketId)?.tags).toContain("auth")
      expect(parsed.nextCursor).toBeNull()
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_list_ticket_comments returns the seeded comment", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_list_ticket_comments",
        arguments: { ticketId },
      })
      const parsed = parseToolText<{ items: Array<{ body: string; source: string }> }>(result)
      expect(parsed.items[0]?.body).toBe("Reproduced on Chrome 132")
      expect(parsed.items[0]?.source).toBe("dashboard")
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_list_project_members returns the seeded developer", async () => {
    const { client, projectId, userId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_list_project_members",
        arguments: { projectId },
      })
      const parsed = parseToolText<Array<{ userId: string; projectRole: string }>>(result)
      expect(parsed.find((m) => m.userId === userId)?.projectRole).toBe("developer")
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_get_ticket_cookies returns captured cookies", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_get_ticket_cookies",
        arguments: { ticketId },
      })
      const parsed = parseToolText<{ cookies: Array<{ name: string; value: string }> }>(result)
      expect(parsed.cookies[0]?.name).toBe("host_session")
      expect(parsed.cookies[0]?.value).toBe("•••")
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_get_screenshot returns NOT_FOUND when no screenshot is attached", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_get_screenshot",
        arguments: { ticketId },
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
      const txt = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ""
      expect(txt).toMatch(/NOT_FOUND/)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_get_replay_transcript returns NOT_FOUND when no replay is attached", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_get_replay_transcript",
        arguments: { ticketId },
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
      const txt = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ""
      expect(txt).toMatch(/NOT_FOUND/)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_get_replay_raw returns NOT_FOUND when no replay is attached", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_get_replay_raw",
        arguments: { ticketId },
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
    } finally {
      await client.close()
    }
  }, 30_000)
})
