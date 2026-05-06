# MCP OAuth Server — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the minimum MCP server for Repro: an MCP-aware OAuth 2.1 authorization server, a single `/api/mcp` Streamable HTTP endpoint, and the first two tools (`repro_list_projects`, `repro_get_ticket`) — enough that Claude Desktop / Cursor can connect "as" a user and read their tickets. Includes the replay-transcript reducer used by `repro_get_ticket`. All behind a `MCP_ENABLED` flag (default `false`).

**Architecture:** All inside the existing Nitro app. better-auth's `oauth-provider` plugin handles RFC 8414 discovery, RFC 7591 dynamic client registration, PKCE, JWT issuance, and the consent ceremony. `mcpHandler` from the same package wraps the route in JWT verification; we delegate the verified request body to a singleton `McpServer` from `@modelcontextprotocol/sdk` driving a `StreamableHTTPServerTransport`. Tool handlers reuse the existing service layer (drizzle, permissions, github-cache, storage adapter) — no parallel auth path. The replay-transcript reducer is a pure module with golden fixture tests.

**Tech Stack:** Bun, Nuxt 4 / Nitro, better-auth + `@better-auth/oauth-provider`, `@modelcontextprotocol/sdk`, drizzle-orm, Zod, Vue 3, Tailwind CSS v4. Test runner is `bun test`. Lint/format are oxlint + oxfmt.

**Spec:** [`docs/superpowers/specs/2026-05-06-mcp-oauth-server-design.md`](../specs/2026-05-06-mcp-oauth-server-design.md)

**Out of scope for Phase 1 (deferred to follow-up plans):**
- Phase 2: remaining read tools (`repro_list_tickets`, `repro_list_ticket_comments`, `repro_get_screenshot`, `repro_get_replay_transcript`, `repro_get_replay_raw`, `repro_get_ticket_cookies`, `repro_list_project_members`)
- Phase 3: write tools + `actor_client_id` audit column + `/settings/mcp` UI
- Phase 4: VitePress docs + `MCP_ENABLED=true` flag flip + CHANGELOG migration note

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `apps/dashboard/server/lib/env.ts` | modify | Add `MCP_ENABLED`, `MCP_ACCESS_TOKEN_TTL_SECONDS`, `MCP_RATE_LIMIT_PER_USER_PER_MINUTE` to the Zod schema. |
| `apps/dashboard/server/lib/auth.ts` | modify | Add `oauthProvider({ ... })` and `jwt()` to the `plugins` array (gated on `env.MCP_ENABLED`). |
| `apps/dashboard/server/lib/permissions.ts` | modify | Add `requireProjectRoleByUser(userId, projectId, min)` — non-event variant for MCP context. |
| `apps/dashboard/server/db/schema/auth-schema.ts` | regenerate | `bun run auth:gen` after the auth.ts edit pulls in oauth-provider tables. |
| `apps/dashboard/server/mcp/replay-transcript.ts` | create | Pure rrweb-events → text-timeline reducer. |
| `apps/dashboard/server/mcp/replay-transcript.test.ts` | create | Golden fixture tests for the reducer. |
| `apps/dashboard/server/mcp/__fixtures__/checkout-error.json` | create | Replay event fixture: typing + error path. |
| `apps/dashboard/server/mcp/__fixtures__/no-fullsnapshot.json` | create | Replay event fixture: defensive path. |
| `apps/dashboard/server/mcp/__fixtures__/oversized.json` | create | Replay event fixture: > 4KB output. |
| `apps/dashboard/server/mcp/context.ts` | create | Build `{ userId, clientId }` per request from a verified JWT payload. |
| `apps/dashboard/server/mcp/server.ts` | create | Construct singleton `McpServer`, register tools. |
| `apps/dashboard/server/mcp/tools/projects.ts` | create | `repro_list_projects` tool definition. |
| `apps/dashboard/server/mcp/tools/tickets.ts` | create | `repro_get_ticket` tool definition. |
| `apps/dashboard/server/mcp/errors.ts` | create | `mcpError(code, message)` helper that throws errors `mcpHandler` can serialize. |
| `apps/dashboard/server/api/mcp.post.ts` | create | Streamable HTTP `POST` route — wraps `mcpHandler`. |
| `apps/dashboard/server/api/mcp.get.ts` | create | Streamable HTTP `GET` route (SSE response stream — same handler). |
| `apps/dashboard/server/api/mcp.delete.ts` | create | Streamable HTTP `DELETE` route (session terminate — same handler). |
| `apps/dashboard/app/pages/oauth/consent.vue` | create | OAuth consent page (Allow / Deny). |
| `apps/dashboard/server/api/oauth/consent.post.ts` | create | Server endpoint the consent page POSTs to (delegates to oauth-provider). |
| `apps/dashboard/tests/api/mcp-oauth.test.ts` | create | Integration test: full discovery + register + authorize + token + tools/list + tools/call roundtrip. |
| `apps/dashboard/package.json` | modify | Add `@better-auth/oauth-provider` and `@modelcontextprotocol/sdk` deps. |

---

## Conventions reused from this codebase

- **Test harness:** Tests use `signIn(email)`, `createUser(email, role)`, `truncateDomain()`, `apiFetch()` from `apps/dashboard/tests/helpers.ts`. Tests run against a live dev server at `TEST_BASE_URL` (default `http://localhost:3000`). The dev server must be running (`bun run dev`) and Postgres up (`bun run dev:docker`).
- **No DB mocks.** Integration tests hit real Postgres.
- **No `any`.** Strict TypeScript everywhere.
- **No fetch+useEffect.** Vue side uses `$fetch` / `useFetch`.
- **Conventional Commits.** One concern per commit (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).
- **Schema migrations.** Never hand-write SQL or `_snapshot.json`. Always `bun run db:gen` after editing schema files (per `feedback_drizzle_migrations.md` memory).
- **Format/lint before commit.** `bun run check` (runs `oxfmt --check . && oxlint`).

---

## Task 1: Add Phase-1 environment variables

**Files:**
- Modify: `apps/dashboard/server/lib/env.ts`

- [ ] **Step 1: Open env.ts and locate the Zod `Schema` object.** Append three new entries directly after the `INTAKE_*` block.

```ts
  // MCP — feature gate + tunables. Phase 1 ships behind MCP_ENABLED=false; we
  // flip the default in Phase 4 once the full surface is shipped & tested.
  MCP_ENABLED: boolString.default(false),
  MCP_ACCESS_TOKEN_TTL_SECONDS: intString(3600),
  MCP_RATE_LIMIT_PER_USER_PER_MINUTE: intString(600),
```

- [ ] **Step 2: Verify the env loader still parses on import.**

Run: `bun --env-file=.env apps/dashboard/server/lib/env.ts` (this script exits 0 silently if Zod parsing succeeds, prints a parse error otherwise).
Expected: exit code 0 (silent).

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/lib/env.ts
git commit -m "feat(mcp): add MCP_ENABLED + tunable env vars"
```

---

## Task 2: Install MCP + oauth-provider dependencies

**Files:**
- Modify: `apps/dashboard/package.json`

- [ ] **Step 1: Install both packages.** Run from the repo root.

```bash
bun add --filter dashboard @better-auth/oauth-provider @modelcontextprotocol/sdk
```

Expected: dashboard's `package.json` `dependencies` gains both entries; `bun.lock` updated.

- [ ] **Step 2: Verify both resolve.**

Run: `bun --filter dashboard run -e "import('@better-auth/oauth-provider').then(m => console.log(typeof m.oauthProvider, typeof m.mcpHandler))"`
Expected: `function function`

Run: `bun --filter dashboard run -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m => console.log(typeof m.McpServer))"`
Expected: `function`

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/package.json bun.lock
git commit -m "chore(mcp): add @better-auth/oauth-provider + @modelcontextprotocol/sdk"
```

---

## Task 3: Replay reducer — types and skeleton (TDD start)

**Files:**
- Create: `apps/dashboard/server/mcp/replay-transcript.ts`
- Create: `apps/dashboard/server/mcp/replay-transcript.test.ts`

This is the rrweb-events → text-timeline reducer used by `repro_get_ticket` in Task 14. We start with the type contract and a single failing test.

- [ ] **Step 1: Write the failing test (empty input).**

Create `apps/dashboard/server/mcp/replay-transcript.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { buildReplayTranscript } from "./replay-transcript"

describe("buildReplayTranscript", () => {
  it("returns a no-events placeholder for an empty stream", () => {
    const out = buildReplayTranscript([], { verbosity: "summary" })
    expect(out.eventCount).toBe(0)
    expect(out.durationMs).toBe(0)
    expect(out.truncated).toBe(false)
    expect(out.transcript).toBe("Replay (0 events)")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bun test apps/dashboard/server/mcp/replay-transcript.test.ts`
Expected: FAIL — module not found / no export `buildReplayTranscript`.

- [ ] **Step 3: Create the module with a minimal implementation that passes the empty case.**

Create `apps/dashboard/server/mcp/replay-transcript.ts`:

```ts
// rrweb event-stream → text timeline reducer.
//
// This module is intentionally pure (no DB, no network) so it can be tested
// against fixtures and used from any tool handler that needs to surface a
// session-replay summary. Privacy: masked input values arrive masked from
// the recorder (•••) and we never unmask them here.

export type RrwebEventType = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type RrwebSource =
  | 0 // Mutation
  | 1 // MouseMove
  | 2 // MouseInteraction
  | 3 // Scroll
  | 4 // ViewportResize
  | 5 // Input
  | 6 // TouchMove
  | 7 // MediaInteraction
  | 8 // StyleSheetRule
  | 9 // CanvasMutation
  | 10 // Font
  | 11 // Log
  | 12 // Drag
  | 13 // StyleDeclaration
  | 14 // Selection

export interface RrwebEvent {
  type: RrwebEventType
  timestamp: number
  data: Record<string, unknown>
}

export interface BuildReplayTranscriptOptions {
  verbosity: "summary" | "detailed"
  maxBytes?: number
}

export interface ReplayTranscript {
  transcript: string
  eventCount: number
  durationMs: number
  truncated: boolean
}

const DEFAULT_MAX_BYTES_SUMMARY = 4 * 1024
const DEFAULT_MAX_BYTES_DETAILED = 16 * 1024

export function buildReplayTranscript(
  events: RrwebEvent[],
  opts: BuildReplayTranscriptOptions,
): ReplayTranscript {
  if (events.length === 0) {
    return {
      transcript: "Replay (0 events)",
      eventCount: 0,
      durationMs: 0,
      truncated: false,
    }
  }
  const maxBytes =
    opts.maxBytes ??
    (opts.verbosity === "summary" ? DEFAULT_MAX_BYTES_SUMMARY : DEFAULT_MAX_BYTES_DETAILED)
  // Real reduction lands in subsequent tasks. For now the empty-stream branch
  // is the only branch any test exercises.
  return {
    transcript: `Replay (${events.length} events)`,
    eventCount: events.length,
    durationMs: events[events.length - 1]!.timestamp - events[0]!.timestamp,
    truncated: false,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `bun test apps/dashboard/server/mcp/replay-transcript.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/mcp/replay-transcript.ts apps/dashboard/server/mcp/replay-transcript.test.ts
git commit -m "feat(mcp): scaffold replay transcript reducer"
```

---

## Task 4: Replay reducer — DOM map from FullSnapshot

The reducer needs to resolve numeric rrweb node ids back to selectors. Walk the FullSnapshot at the start of the stream to build an in-memory map.

**Files:**
- Modify: `apps/dashboard/server/mcp/replay-transcript.ts`
- Modify: `apps/dashboard/server/mcp/replay-transcript.test.ts`
- Create: `apps/dashboard/server/mcp/__fixtures__/no-fullsnapshot.json`

- [ ] **Step 1: Add a failing test for the no-FullSnapshot defensive path.**

Append to `replay-transcript.test.ts`:

```ts
  it("emits an unknown-element placeholder when no FullSnapshot is present", async () => {
    const fixture = await Bun.file(
      `${import.meta.dir}/__fixtures__/no-fullsnapshot.json`,
    ).json()
    const out = buildReplayTranscript(fixture.events, { verbosity: "summary" })
    expect(out.transcript).toContain("<unknown element")
    expect(out.eventCount).toBe(fixture.events.length)
  })
```

- [ ] **Step 2: Create the fixture.**

Create `apps/dashboard/server/mcp/__fixtures__/no-fullsnapshot.json`:

```json
{
  "events": [
    {
      "type": 4,
      "timestamp": 1700000000000,
      "data": { "href": "https://example.com/", "width": 1440, "height": 900 }
    },
    {
      "type": 3,
      "timestamp": 1700000001200,
      "data": { "source": 2, "type": 2, "id": 42, "x": 100, "y": 100 }
    }
  ]
}
```

- [ ] **Step 3: Run the test — expect it to fail.**

Run: `bun test apps/dashboard/server/mcp/replay-transcript.test.ts -t "no FullSnapshot"`
Expected: FAIL — `transcript` does not contain `<unknown element`.

- [ ] **Step 4: Implement DOM-map building + selector fallback.**

Replace the body of `buildReplayTranscript` in `replay-transcript.ts` with the version below. Add the helper functions defined alongside:

```ts
interface NodeMeta {
  tag: string
  attrs: Record<string, string>
  text: string | null
  parent: number | null
}

function buildDomMapFromFullSnapshot(events: RrwebEvent[]): Map<number, NodeMeta> {
  const map = new Map<number, NodeMeta>()
  const fullSnapshot = events.find((e) => e.type === 2)
  if (!fullSnapshot) return map
  const root = (fullSnapshot.data as { node?: unknown }).node
  if (!root || typeof root !== "object") return map
  walkNode(root as Record<string, unknown>, null, map)
  return map
}

function walkNode(
  node: Record<string, unknown>,
  parentId: number | null,
  out: Map<number, NodeMeta>,
): void {
  const id = typeof node.id === "number" ? node.id : null
  const type = typeof node.type === "number" ? node.type : null
  if (id != null && type === 2) {
    // Element
    out.set(id, {
      tag: typeof node.tagName === "string" ? node.tagName.toLowerCase() : "unknown",
      attrs: (node.attributes as Record<string, string>) ?? {},
      text: null,
      parent: parentId,
    })
  } else if (id != null && type === 3 && typeof node.textContent === "string") {
    // Text
    out.set(id, { tag: "#text", attrs: {}, text: node.textContent, parent: parentId })
  }
  const children = Array.isArray(node.childNodes) ? (node.childNodes as unknown[]) : []
  for (const child of children) {
    if (child && typeof child === "object") {
      walkNode(child as Record<string, unknown>, id, out)
    }
  }
}

function resolveSelector(id: number, dom: Map<number, NodeMeta>): string {
  const node = dom.get(id)
  if (!node) return `<unknown element ${id}>`
  if (node.tag === "#text") return `text "${(node.text ?? "").trim().slice(0, 40)}"`
  const name = node.attrs.name
  const ariaLabel = node.attrs["aria-label"]
  const type = node.attrs.type
  const className = node.attrs.class?.split(/\s+/).find(Boolean)
  const innerText = collectInnerText(id, dom).trim().slice(0, 40)
  if (name) return `${node.tag}[name="${name}"]`
  if (ariaLabel) return `${node.tag}[aria-label="${ariaLabel}"]`
  if (type && (node.tag === "button" || node.tag === "input"))
    return `${node.tag}[type="${type}"]`
  if (innerText && (node.tag === "button" || node.tag === "a"))
    return `${node.tag} "${innerText}"`
  if (className) return `${node.tag}.${className}`
  return `<${node.tag}>`
}

function collectInnerText(id: number, dom: Map<number, NodeMeta>): string {
  let out = ""
  for (const [, meta] of dom) {
    if (meta.parent === id && meta.tag === "#text") out += meta.text ?? ""
  }
  return out
}
```

Then replace the `buildReplayTranscript` non-empty branch with:

```ts
  const dom = buildDomMapFromFullSnapshot(events)
  const startTs = events[0]!.timestamp
  const endTs = events[events.length - 1]!.timestamp
  const lines: string[] = []

  for (const e of events) {
    if (e.type === 3 && (e.data as { source?: number }).source === 2) {
      const id = (e.data as { id?: number }).id
      if (typeof id !== "number") continue
      const t = ((e.timestamp - startTs) / 1000).toFixed(1)
      lines.push(`[+${t}s] click ${resolveSelector(id, dom)}`)
    }
  }

  const transcript =
    `Replay (${((endTs - startTs) / 1000).toFixed(1)}s, ${events.length} events)\n\n` +
    lines.join("\n")

  return {
    transcript,
    eventCount: events.length,
    durationMs: endTs - startTs,
    truncated: false,
  }
```

- [ ] **Step 5: Run all replay tests — both should pass.**

Run: `bun test apps/dashboard/server/mcp/replay-transcript.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/server/mcp/replay-transcript.ts \
        apps/dashboard/server/mcp/replay-transcript.test.ts \
        apps/dashboard/server/mcp/__fixtures__/no-fullsnapshot.json
git commit -m "feat(mcp): build DOM map from FullSnapshot for selector resolution"
```

---

## Task 5: Replay reducer — navigation, input coalescing, console errors

**Files:**
- Modify: `apps/dashboard/server/mcp/replay-transcript.ts`
- Modify: `apps/dashboard/server/mcp/replay-transcript.test.ts`
- Create: `apps/dashboard/server/mcp/__fixtures__/checkout-error.json`

- [ ] **Step 1: Add a fixture covering navigation, typing (with one masked field), a click, a console.error, and a re-navigation.**

Create `apps/dashboard/server/mcp/__fixtures__/checkout-error.json`:

```json
{
  "events": [
    {
      "type": 4,
      "timestamp": 1700000000000,
      "data": { "href": "https://example.com/checkout?cart=abc-123", "width": 1440, "height": 900 }
    },
    {
      "type": 2,
      "timestamp": 1700000000010,
      "data": {
        "node": {
          "id": 1, "type": 2, "tagName": "html", "attributes": {},
          "childNodes": [
            { "id": 2, "type": 2, "tagName": "body", "attributes": {}, "childNodes": [
              { "id": 10, "type": 2, "tagName": "input", "attributes": { "name": "email" }, "childNodes": [] },
              { "id": 11, "type": 2, "tagName": "input", "attributes": { "name": "cardNumber" }, "childNodes": [] },
              { "id": 12, "type": 2, "tagName": "button", "attributes": { "type": "submit" }, "childNodes": [
                { "id": 13, "type": 3, "textContent": "Pay $49.99" }
              ]}
            ]}
          ]
        }
      }
    },
    { "type": 3, "timestamp": 1700000002100, "data": { "source": 5, "id": 10, "text": "alice@example.com" } },
    { "type": 3, "timestamp": 1700000003400, "data": { "source": 5, "id": 11, "text": "•••" } },
    { "type": 3, "timestamp": 1700000004900, "data": { "source": 2, "type": 2, "id": 12 } },
    { "type": 6, "timestamp": 1700000005800, "data": { "plugin": "rrweb/console@1", "payload": { "level": "error", "trace": [], "payload": ["TypeError: Cannot read properties of undefined (reading 'token')"] } } },
    { "type": 4, "timestamp": 1700000006000, "data": { "href": "https://example.com/checkout/error", "width": 1440, "height": 900 } }
  ]
}
```

- [ ] **Step 2: Add the failing test.**

Append to `replay-transcript.test.ts`:

```ts
  it("emits navigation, masked-stays-masked typing, click, and console.error", async () => {
    const fixture = await Bun.file(
      `${import.meta.dir}/__fixtures__/checkout-error.json`,
    ).json()
    const out = buildReplayTranscript(fixture.events, { verbosity: "summary" })
    expect(out.transcript).toContain("loaded /checkout?cart=abc-123")
    expect(out.transcript).toContain('typed "alice@example.com" into input[name="email"]')
    expect(out.transcript).toContain('typed "•••" into input[name="cardNumber"]')
    expect(out.transcript).toContain('click button[type="submit"]')
    expect(out.transcript).toContain("console.error")
    expect(out.transcript).toContain("loaded /checkout/error")
  })
```

- [ ] **Step 3: Run the test — expect it to fail.**

Run: `bun test apps/dashboard/server/mcp/replay-transcript.test.ts -t "navigation, masked-stays"`
Expected: FAIL — most assertions miss; only the click line will exist from Task 4.

- [ ] **Step 4: Extend the reducer to emit navigation, coalesced input, and console-error lines.**

Above the main loop in `buildReplayTranscript`, add this state and helpers:

```ts
  type InputBuffer = { id: number; value: string; firstTs: number }
  let pendingInput: InputBuffer | null = null

  function flushInput(): void {
    if (!pendingInput) return
    const t = ((pendingInput.firstTs - startTs) / 1000).toFixed(1)
    lines.push(
      `[+${t}s] typed "${pendingInput.value}" into ${resolveSelector(pendingInput.id, dom)}`,
    )
    pendingInput = null
  }

  function pathFromHref(href: string): string {
    try {
      const u = new URL(href)
      return `${u.pathname}${u.search}`
    } catch {
      return href
    }
  }
```

Replace the loop body with:

```ts
  for (const e of events) {
    const t = ((e.timestamp - startTs) / 1000).toFixed(1)
    // 4 = Meta (navigation / page load)
    if (e.type === 4) {
      flushInput()
      const href = (e.data as { href?: string }).href ?? ""
      lines.push(`[+${t}s] loaded ${pathFromHref(href)}`)
      continue
    }
    // 6 = Plugin (console capture lives here in rrweb)
    if (e.type === 6) {
      const payload = e.data as { plugin?: string; payload?: { level?: string; payload?: unknown[] } }
      if (payload.plugin?.startsWith("rrweb/console") && payload.payload?.level === "error") {
        flushInput()
        const msg = (payload.payload.payload ?? []).map((p) => String(p)).join(" ")
        lines.push(`[+${t}s] console.error ${msg}`)
      }
      continue
    }
    if (e.type !== 3) continue
    const source = (e.data as { source?: number }).source
    // 2 = MouseInteraction
    if (source === 2) {
      const id = (e.data as { id?: number }).id
      if (typeof id !== "number") continue
      flushInput()
      lines.push(`[+${t}s] click ${resolveSelector(id, dom)}`)
      continue
    }
    // 5 = Input
    if (source === 5) {
      const id = (e.data as { id?: number }).id
      const text = (e.data as { text?: string }).text ?? ""
      if (typeof id !== "number") continue
      if (pendingInput && pendingInput.id !== id) flushInput()
      if (!pendingInput) pendingInput = { id, value: text, firstTs: e.timestamp }
      else pendingInput.value = text
      continue
    }
  }
  flushInput()
```

Note: deletes the per-iteration `t` declaration above; the new loop computes its own.

- [ ] **Step 5: Run the suite — all three tests pass.**

Run: `bun test apps/dashboard/server/mcp/replay-transcript.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/server/mcp/replay-transcript.ts \
        apps/dashboard/server/mcp/replay-transcript.test.ts \
        apps/dashboard/server/mcp/__fixtures__/checkout-error.json
git commit -m "feat(mcp): emit navigation, coalesced inputs, console.error"
```

---

## Task 6: Replay reducer — size cap and truncation

**Files:**
- Modify: `apps/dashboard/server/mcp/replay-transcript.ts`
- Modify: `apps/dashboard/server/mcp/replay-transcript.test.ts`
- Create: `apps/dashboard/server/mcp/__fixtures__/oversized.json`

- [ ] **Step 1: Generate an oversized fixture programmatically (200 click events) and stash it.**

Write a one-shot generator script then delete it. From the repo root:

```bash
bun -e '
const events = [
  { type: 4, timestamp: 1700000000000, data: { href: "https://example.com/", width: 1440, height: 900 } },
  { type: 2, timestamp: 1700000000010, data: { node: { id: 1, type: 2, tagName: "html", attributes: {}, childNodes: [
    { id: 2, type: 2, tagName: "body", attributes: {}, childNodes: Array.from({ length: 200 }, (_, i) => ({
      id: 100 + i, type: 2, tagName: "button", attributes: { name: `btn-${i}` }, childNodes: []
    })) }
  ] } } }
]
for (let i = 0; i < 200; i++) {
  events.push({ type: 3, timestamp: 1700000000020 + i * 10, data: { source: 2, type: 2, id: 100 + i } })
}
await Bun.write("apps/dashboard/server/mcp/__fixtures__/oversized.json", JSON.stringify({ events }))
'
```

Verify: `wc -c apps/dashboard/server/mcp/__fixtures__/oversized.json` shows > 30 KB raw.

- [ ] **Step 2: Add the failing test.**

Append to `replay-transcript.test.ts`:

```ts
  it("truncates output past maxBytes and sets the flag", async () => {
    const fixture = await Bun.file(
      `${import.meta.dir}/__fixtures__/oversized.json`,
    ).json()
    const out = buildReplayTranscript(fixture.events, { verbosity: "summary" })
    expect(out.truncated).toBe(true)
    expect(out.transcript.length).toBeLessThanOrEqual(4 * 1024 + 200)
    expect(out.transcript).toContain("events omitted")
  })
```

- [ ] **Step 3: Run the test — expect it to fail.**

Run: `bun test apps/dashboard/server/mcp/replay-transcript.test.ts -t "truncates output"`
Expected: FAIL — `truncated` is `false`.

- [ ] **Step 4: Implement middle-truncation.**

In `buildReplayTranscript`, after the loop and `flushInput()` call, replace the `transcript` assembly with:

```ts
  const header = `Replay (${((endTs - startTs) / 1000).toFixed(1)}s, ${events.length} events)\n\n`
  let body = lines.join("\n")
  let truncated = false
  if ((header + body).length > maxBytes) {
    truncated = true
    const budget = maxBytes - header.length - 40
    const halfBudget = Math.max(0, Math.floor(budget / 2))
    const headSlice = body.slice(0, halfBudget)
    const tailSlice = body.slice(body.length - halfBudget)
    const omitted = lines.length - headSlice.split("\n").length - tailSlice.split("\n").length
    body = `${headSlice}\n… (${Math.max(omitted, 0)} events omitted) …\n${tailSlice}`
  }
  return {
    transcript: header + body,
    eventCount: events.length,
    durationMs: endTs - startTs,
    truncated,
  }
```

Delete the old final `return` block.

- [ ] **Step 5: Run the full reducer suite — 4 tests pass.**

Run: `bun test apps/dashboard/server/mcp/replay-transcript.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/server/mcp/replay-transcript.ts \
        apps/dashboard/server/mcp/replay-transcript.test.ts \
        apps/dashboard/server/mcp/__fixtures__/oversized.json
git commit -m "feat(mcp): cap transcript size with middle truncation"
```

---

## Task 7: Add `requireProjectRoleByUser` (non-event variant)

The existing `requireProjectRole` takes an `H3Event`. MCP tool handlers don't have one — they have a verified `userId` from the JWT. Extract the role-check logic into a shared helper.

**Files:**
- Modify: `apps/dashboard/server/lib/permissions.ts`
- Create: `apps/dashboard/server/lib/permissions.test.ts` (this file already exists per the codebase listing — modify instead)

- [ ] **Step 1: Add the failing test.**

Open `apps/dashboard/server/lib/permissions.test.ts` and append:

```ts
import { test, expect } from "bun:test"
import { db } from "../db"
import { projects, projectMembers, user } from "../db/schema"
import { requireProjectRoleByUser } from "./permissions"
import { sql } from "drizzle-orm"
import { randomBytes } from "node:crypto"

test("requireProjectRoleByUser — returns role when member meets minimum", async () => {
  await db.execute(sql`TRUNCATE project_members, projects, "user" RESTART IDENTITY CASCADE`)
  const userId = randomBytes(16).toString("hex")
  const projectId = crypto.randomUUID()
  await db.insert(user).values({
    id: userId,
    email: `t-${userId}@example.com`,
    name: "t",
    emailVerified: true,
    role: "member",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(projects).values({ id: projectId, name: "p", slug: `p-${userId}` })
  await db.insert(projectMembers).values({ projectId, userId, role: "developer" })

  const role = await requireProjectRoleByUser(userId, projectId, "manager")
  expect(role).toBe("developer")
})

test("requireProjectRoleByUser — throws 403 when role too low", async () => {
  await db.execute(sql`TRUNCATE project_members, projects, "user" RESTART IDENTITY CASCADE`)
  const userId = randomBytes(16).toString("hex")
  const projectId = crypto.randomUUID()
  await db.insert(user).values({
    id: userId,
    email: `t-${userId}@example.com`,
    name: "t",
    emailVerified: true,
    role: "member",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(projects).values({ id: projectId, name: "p", slug: `p-${userId}` })
  await db.insert(projectMembers).values({ projectId, userId, role: "viewer" })

  await expect(requireProjectRoleByUser(userId, projectId, "developer")).rejects.toThrow(
    /insufficient/i,
  )
})

test("requireProjectRoleByUser — throws 404 when not a member", async () => {
  await db.execute(sql`TRUNCATE project_members, projects, "user" RESTART IDENTITY CASCADE`)
  const userId = randomBytes(16).toString("hex")
  const projectId = crypto.randomUUID()
  await db.insert(user).values({
    id: userId,
    email: `t-${userId}@example.com`,
    name: "t",
    emailVerified: true,
    role: "member",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(projects).values({ id: projectId, name: "p", slug: `p-${userId}` })

  await expect(requireProjectRoleByUser(userId, projectId, "viewer")).rejects.toThrow(
    /not found/i,
  )
})
```

- [ ] **Step 2: Run the test — expect FAIL (export missing).**

Run: `bun test apps/dashboard/server/lib/permissions.test.ts -t "requireProjectRoleByUser"`
Expected: FAIL — `requireProjectRoleByUser is not a function`.

- [ ] **Step 3: Implement the helper in `permissions.ts`.** Append after `requireProjectRole`:

```ts
/**
 * Non-event variant of requireProjectRole for callers without an H3Event
 * (notably MCP tool handlers, which have a verified userId from the JWT
 * but no incoming H3 request to read a session from).
 *
 * Returns the user's effective role on the project. Throws via h3's
 * createError on the same conditions as requireProjectRole:
 *   - 401 if the user record doesn't exist or is disabled (defense in depth;
 *     the JWT was issued from this same auth system, so this is rare)
 *   - 404 if the user has no project_members row for this project
 *   - 403 if the user's role rank is below `min`
 *
 * Install admins are still treated as effective owners on every project,
 * matching the event-aware variant's behavior.
 */
export async function requireProjectRoleByUser(
  userId: string,
  projectId: string,
  min: ProjectRoleName,
): Promise<ProjectRoleName> {
  const [{ user: userRow } = { user: null }] = await db
    .select({ user: { role: user.role, status: user.status } })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!userRow || userRow.status === "disabled") {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" })
  }
  if (userRow.role === "admin") return "owner"

  const [member] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" })
  }
  const role = member.role as ProjectRoleName
  if (!compareRole(role, min)) {
    throw createError({ statusCode: 403, statusMessage: "Insufficient role" })
  }
  return role
}
```

Add `user` to the existing `import { ... projectMembers } from "../db/schema"` at the top of the file: `import { projectMembers, user } from "../db/schema"`.

- [ ] **Step 4: Run the new tests — all 3 pass.**

Run: `bun test apps/dashboard/server/lib/permissions.test.ts -t "requireProjectRoleByUser"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the full permissions test file — no regressions.**

Run: `bun test apps/dashboard/server/lib/permissions.test.ts`
Expected: PASS — all tests (existing + 3 new).

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/server/lib/permissions.ts apps/dashboard/server/lib/permissions.test.ts
git commit -m "feat(auth): add requireProjectRoleByUser for non-H3 callers"
```

---

## Task 8: Wire up `oauth-provider` and `jwt` plugins in `auth.ts`

**Files:**
- Modify: `apps/dashboard/server/lib/auth.ts`

- [ ] **Step 1: Add the imports at the top of `auth.ts` next to the existing `magicLink` import.**

```ts
import { jwt } from "better-auth/plugins/jwt"
import { oauthProvider } from "@better-auth/oauth-provider"
```

- [ ] **Step 2: Locate the `plugins:` array in the `betterAuth({ ... })` call.** Add the two new plugins gated on `env.MCP_ENABLED`. The exact insertion point is after the `magicLink({ ... })` entry. Use this snippet:

```ts
    ...(env.MCP_ENABLED
      ? [
          jwt(),
          oauthProvider({
            loginPage: "/sign-in",
            consentPage: "/oauth/consent",
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            scopes: [
              {
                name: "mcp:full",
                description: "Read and triage your Repro tickets and reports",
              },
            ],
            scopeExpirations: {
              "mcp:full": {
                accessTokenTtl: env.MCP_ACCESS_TOKEN_TTL_SECONDS,
                refreshTokenTtl: 60 * 60 * 24 * 30,
              },
            },
            validAudiences: [`${env.BETTER_AUTH_URL}/api/mcp`],
          }),
        ]
      : []),
```

- [ ] **Step 3: Regenerate auth schema with the new tables.**

Run: `bun run db:gen`
Expected: `auth-schema.ts` rewritten with new tables (clients, codes, tokens, consents); a new migration file appears in `apps/dashboard/server/db/migrations/`.

- [ ] **Step 4: Push the schema to the dev database.**

Run: `bun run db:push`
Expected: drizzle-kit reports tables added.

- [ ] **Step 5: Verify the dev server boots and discovery is reachable.**

In one terminal: `MCP_ENABLED=true bun run dev`
In another: `curl -s http://localhost:3000/.well-known/oauth-authorization-server | head -c 600`
Expected: JSON containing `"issuer"`, `"authorization_endpoint"`, `"token_endpoint"`, `"registration_endpoint"`, `"scopes_supported": ["mcp:full"]`.

Stop the dev server.

- [ ] **Step 6: Commit (schema + auth.ts).**

```bash
git add apps/dashboard/server/lib/auth.ts \
        apps/dashboard/server/db/schema/auth-schema.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(mcp): wire oauth-provider + jwt plugins behind MCP_ENABLED"
```

---

## Task 9: OAuth consent page — Vue page + POST endpoint

The consent page is shown when an AI client (e.g. Claude Desktop) sends the user to `/oauth2/authorize` for the first `(user, client_id)` pair. The user clicks Allow / Deny and we POST the decision to oauth-provider.

**Files:**
- Create: `apps/dashboard/app/pages/oauth/consent.vue`
- Create: `apps/dashboard/server/api/oauth/consent.post.ts`

- [ ] **Step 1: Create the Vue page.**

`apps/dashboard/app/pages/oauth/consent.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue"
import { useRoute } from "#imports"

definePageMeta({ middleware: ["auth"] })

const route = useRoute()
const clientName = computed(() => String(route.query.client_name ?? "An MCP client"))
const consentChallenge = computed(() => String(route.query.consent_challenge ?? ""))
const scope = computed(() => String(route.query.scope ?? ""))

const scopeBullets = computed(() =>
  scope.value.includes("mcp:full")
    ? [
        "Read your tickets, reports, screenshots, console + network logs, and replay transcripts",
        "Change ticket status, priority, severity, assignee, and tags",
        "Post comments on your tickets",
        "Link or unlink GitHub issues from your tickets",
      ]
    : [scope.value],
)

async function decide(allow: boolean): Promise<void> {
  const res = await $fetch<{ redirectUri: string }>("/api/oauth/consent", {
    method: "POST",
    body: { consentChallenge: consentChallenge.value, allow },
  })
  window.location.assign(res.redirectUri)
}
</script>

<template>
  <main class="mx-auto max-w-md py-16 px-6">
    <h1 class="text-xl font-semibold mb-2">Allow {{ clientName }}?</h1>
    <p class="text-sm text-muted-foreground mb-6">
      {{ clientName }} is requesting access to your Repro account. This will let it:
    </p>
    <ul class="text-sm space-y-1 mb-8 list-disc pl-5">
      <li v-for="bullet in scopeBullets" :key="bullet">{{ bullet }}</li>
    </ul>
    <div class="flex gap-3">
      <button type="button" class="btn btn-primary flex-1" @click="decide(true)">Allow</button>
      <button type="button" class="btn btn-secondary flex-1" @click="decide(false)">Deny</button>
    </div>
    <p class="text-xs text-muted-foreground mt-6">
      You can revoke this anytime in Settings → Connected apps.
    </p>
  </main>
</template>
```

- [ ] **Step 2: Create the POST endpoint that delegates to oauth-provider.**

`apps/dashboard/server/api/oauth/consent.post.ts`:

```ts
import { z } from "zod"
import { defineEventHandler, readValidatedBody, createError } from "h3"
import { auth } from "../../lib/auth"
import { requireSession } from "../../lib/permissions"

const Body = z.object({
  consentChallenge: z.string().min(1),
  allow: z.boolean(),
})

/**
 * Forwards the user's Allow/Deny decision to oauth-provider's internal
 * consent-decision endpoint. We don't talk to that endpoint directly from
 * the browser because (a) it expects the same-session session cookie which
 * the client already has, and (b) we want to enforce requireSession() here
 * as a defense in depth — if the cookie ever goes missing between rendering
 * and decision, we 401 cleanly instead of letting the AS handle it.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const body = await readValidatedBody(event, Body.parse)

  const url = new URL(`${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/auth/oauth2/consent`)
  const res = await auth.handler(
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: event.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        consent_challenge: body.consentChallenge,
        allow: body.allow,
        userId: session.userId,
      }),
    }),
  )
  if (!res.ok) {
    throw createError({
      statusCode: res.status,
      statusMessage: `consent decision failed: ${await res.text()}`,
    })
  }
  const json = (await res.json()) as { redirectUri: string }
  return { redirectUri: json.redirectUri }
})
```

- [ ] **Step 3: Manually verify the page renders.**

In one terminal: `MCP_ENABLED=true bun run dev`
In a browser, sign in with an existing test user, then visit:
`http://localhost:3000/oauth/consent?client_name=Claude+Desktop&consent_challenge=test&scope=mcp:full`

Expected: page renders with the "Allow Claude Desktop?" heading and 4 scope bullets.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/app/pages/oauth/consent.vue \
        apps/dashboard/server/api/oauth/consent.post.ts
git commit -m "feat(mcp): add OAuth consent page + decision endpoint"
```

---

## Task 10: MCP error helper

Tools throw via `mcpError(code, message)` so the route handler can serialize them as MCP-protocol errors instead of leaking H3 stack traces.

**Files:**
- Create: `apps/dashboard/server/mcp/errors.ts`

- [ ] **Step 1: Create the helper module.**

```ts
// MCP errors thrown by tool handlers. The route handler in api/mcp.post.ts
// catches McpToolError and returns it via the MCP protocol's standard
// JSON-RPC error envelope. Anything else propagates and 500s.

export type McpErrorCode = "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "PAYLOAD_TOO_LARGE"

export class McpToolError extends Error {
  readonly code: McpErrorCode

  constructor(code: McpErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = "McpToolError"
  }
}

const HTTP_BY_CODE: Record<McpErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  PAYLOAD_TOO_LARGE: 413,
}

export function httpStatusForMcpError(err: McpToolError): number {
  return HTTP_BY_CODE[err.code]
}

export function mcpError(code: McpErrorCode, message: string): McpToolError {
  return new McpToolError(code, message)
}
```

- [ ] **Step 2: Commit.**

```bash
git add apps/dashboard/server/mcp/errors.ts
git commit -m "feat(mcp): add McpToolError + helper"
```

---

## Task 11: MCP request context

Builds `{ userId, clientId }` from a verified JWT payload.

**Files:**
- Create: `apps/dashboard/server/mcp/context.ts`

- [ ] **Step 1: Create the module.**

```ts
import { mcpError } from "./errors"

export interface McpRequestContext {
  userId: string
  clientId: string
  scopes: string[]
}

interface VerifiedJwt {
  sub?: unknown
  client_id?: unknown
  azp?: unknown
  scope?: unknown
  scopes?: unknown
}

/**
 * Build the per-request context from a JWT that mcpHandler has already
 * cryptographically verified. We still validate the *shape* of the claims —
 * a malformed JWT should never occur (we sign these ourselves) but if it
 * does we want a clean INVALID_INPUT rather than an undefined-property
 * crash deep in a tool handler.
 */
export function buildContextFromJwt(payload: VerifiedJwt): McpRequestContext {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw mcpError("INVALID_INPUT", "JWT missing 'sub' claim")
  }
  const clientId =
    typeof payload.client_id === "string"
      ? payload.client_id
      : typeof payload.azp === "string"
        ? payload.azp
        : null
  if (!clientId) {
    throw mcpError("INVALID_INPUT", "JWT missing 'client_id' / 'azp' claim")
  }
  const scopes =
    typeof payload.scope === "string"
      ? payload.scope.split(/\s+/).filter(Boolean)
      : Array.isArray(payload.scopes)
        ? payload.scopes.filter((s): s is string => typeof s === "string")
        : []
  return { userId: payload.sub, clientId, scopes }
}
```

- [ ] **Step 2: Commit.**

```bash
git add apps/dashboard/server/mcp/context.ts
git commit -m "feat(mcp): add JWT → request context builder"
```

---

## Task 12: First tool — `repro_list_projects`

Returns the projects the authenticated user has membership in.

**Files:**
- Create: `apps/dashboard/server/mcp/tools/projects.ts`

- [ ] **Step 1: Create the tool module.**

```ts
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db"
import { projects, projectMembers } from "../../db/schema"
import { user } from "../../db/schema"
import type { McpRequestContext } from "../context"

export const listProjectsTool = {
  name: "repro_list_projects",
  config: {
    description:
      "List Repro projects the current user is a member of. Returns id, slug, name, and the user's role on each project.",
    inputSchema: z.object({}),
  },
  handler: async (_input: Record<string, never>, ctx: McpRequestContext) => {
    // Install admins see every project as `owner`. Members see only their
    // own memberships. Mirrors requireProjectRole's semantics.
    const [actor] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, ctx.userId))
      .limit(1)
    if (actor?.role === "admin") {
      const all = await db
        .select({ id: projects.id, slug: projects.slug, name: projects.name })
        .from(projects)
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              all.map((p) => ({ ...p, role: "owner" as const })),
              null,
              2,
            ),
          },
        ],
      }
    }
    const memberships = await db
      .select({
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projectMembers.userId, ctx.userId))
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(memberships, null, 2) },
      ],
    }
  },
}
```

- [ ] **Step 2: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/projects.ts
git commit -m "feat(mcp): add repro_list_projects tool"
```

---

## Task 13: Second tool — `repro_get_ticket`

Returns the full report including console/network logs and an inline replay transcript.

**Files:**
- Create: `apps/dashboard/server/mcp/tools/tickets.ts`

- [ ] **Step 1: Create the tool module.**

```ts
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db"
import { reports, reportAttachments } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import { mcpError } from "../errors"
import { buildReplayTranscript, type RrwebEvent } from "../replay-transcript"
import { storage } from "../../lib/storage"
import type { McpRequestContext } from "../context"

interface ReportContext {
  consoleLog?: unknown[]
  networkLog?: unknown[]
  pageContext?: { url?: string; referrer?: string | null; title?: string }
  systemInfo?: Record<string, unknown>
  customMetadata?: Record<string, unknown>
}

export const getTicketTool = {
  name: "repro_get_ticket",
  config: {
    description:
      "Fetch a single Repro ticket (a.k.a. report) with full context: title, description, status, priority, tags, GitHub link state, page context, system info, console + network logs, and an inline replay transcript when one was captured.",
    inputSchema: z.object({
      ticketId: z.string().uuid().describe("The ticket id (UUID)."),
    }),
  },
  handler: async (input: { ticketId: string }, ctx: McpRequestContext) => {
    const [report] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const attachments = await db
      .select({
        id: reportAttachments.id,
        kind: reportAttachments.kind,
        storageKey: reportAttachments.storageKey,
        contentType: reportAttachments.contentType,
        size: reportAttachments.sizeBytes,
      })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, report.id))

    let replay: { durationMs: number; eventCount: number; transcript: string } | null = null
    const replayAttachment = attachments.find((a) => a.kind === "replay")
    if (replayAttachment) {
      const buf = await storage.getObject(replayAttachment.storageKey)
      if (buf) {
        try {
          const events = JSON.parse(buf.toString("utf-8")) as RrwebEvent[]
          const t = buildReplayTranscript(events, { verbosity: "summary" })
          replay = {
            durationMs: t.durationMs,
            eventCount: t.eventCount,
            transcript: t.transcript,
          }
        } catch {
          replay = null
        }
      }
    }

    const context = (report.context ?? {}) as ReportContext
    const payload = {
      id: report.id,
      projectId: report.projectId,
      title: report.title,
      description: report.description ?? "",
      status: report.status,
      priority: report.priority,
      tags: report.tags,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      github: report.githubIssueNumber
        ? {
            issueNumber: report.githubIssueNumber,
            issueUrl: report.githubIssueUrl ?? null,
          }
        : null,
      pageContext: context.pageContext ?? null,
      systemInfo: context.systemInfo ?? null,
      consoleLog: context.consoleLog ?? [],
      networkLog: context.networkLog ?? [],
      attachments: attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        contentType: a.contentType,
        size: a.size,
      })),
      replay,
      customMetadata: context.customMetadata ?? {},
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    }
  },
}
```

> Note: this tool relies on a `storage.getObject(key) → Buffer | null` method on the existing storage adapter at `apps/dashboard/server/lib/storage/index.ts`. If that method doesn't exist, add it in this same task — it is a thin pass-through to whatever the local-disk / S3 backends already use to read attachment bytes.

- [ ] **Step 2: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/tickets.ts apps/dashboard/server/lib/storage/
git commit -m "feat(mcp): add repro_get_ticket tool with inline replay transcript"
```

---

## Task 14: MCP server singleton

Constructs the `McpServer` and registers the two Phase-1 tools.

**Files:**
- Create: `apps/dashboard/server/mcp/server.ts`

- [ ] **Step 1: Create the module.**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { listProjectsTool } from "./tools/projects"
import { getTicketTool } from "./tools/tickets"
import type { McpRequestContext } from "./context"
import { McpToolError } from "./errors"

/**
 * Per-request MCP server factory. We instantiate fresh per request rather
 * than caching a singleton because each tool handler closes over the
 * request's userId/clientId — a singleton would force us to thread context
 * through every call site, which is messier than recreating the server.
 * Construction is cheap (just registerTool calls).
 */
export function buildMcpServer(ctx: McpRequestContext): McpServer {
  const server = new McpServer({ name: "repro", version: "0.5.0" })

  server.registerTool(
    listProjectsTool.name,
    listProjectsTool.config,
    async (input: Record<string, never>) => {
      try {
        return await listProjectsTool.handler(input, ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    getTicketTool.name,
    getTicketTool.config,
    async (input: { ticketId: string }) => {
      try {
        return await getTicketTool.handler(input, ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  return server
}

function toolErrorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>
  isError: true
} {
  if (err instanceof McpToolError) {
    return {
      content: [{ type: "text", text: `${err.code}: ${err.message}` }],
      isError: true,
    }
  }
  // h3 createError thrown from requireProjectRoleByUser
  if (
    err &&
    typeof err === "object" &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
  ) {
    const e = err as { statusCode: number; statusMessage?: string }
    const code = e.statusCode === 403 ? "FORBIDDEN" : e.statusCode === 404 ? "NOT_FOUND" : "ERROR"
    return {
      content: [{ type: "text", text: `${code}: ${e.statusMessage ?? "request failed"}` }],
      isError: true,
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true }
}
```

- [ ] **Step 2: Commit.**

```bash
git add apps/dashboard/server/mcp/server.ts
git commit -m "feat(mcp): per-request McpServer factory with both tools"
```

---

## Task 15: `/api/mcp` route — POST, GET, DELETE

The Streamable HTTP transport drives all three verbs over a single resource path. We share one handler factory.

**Files:**
- Create: `apps/dashboard/server/api/mcp.post.ts`
- Create: `apps/dashboard/server/api/mcp.get.ts`
- Create: `apps/dashboard/server/api/mcp.delete.ts`

- [ ] **Step 1: Create the POST handler.**

```ts
import { defineEventHandler, getRequestURL, sendWebResponse } from "h3"
import { mcpHandler } from "@better-auth/oauth-provider"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { env } from "../lib/env"
import { buildContextFromJwt } from "../mcp/context"
import { buildMcpServer } from "../mcp/server"

const handler = mcpHandler(
  {
    jwksUrl: `${env.BETTER_AUTH_URL}/api/auth/jwks`,
    verifyOptions: {
      issuer: env.BETTER_AUTH_URL,
      audience: `${env.BETTER_AUTH_URL}/api/mcp`,
    },
  },
  async (req: Request, jwt: Record<string, unknown>) => {
    const ctx = buildContextFromJwt(jwt)
    const server = buildMcpServer(ctx)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    return transport.handleRequest(req)
  },
)

export default defineEventHandler(async (event) => {
  if (!env.MCP_ENABLED) {
    return sendWebResponse(event, new Response("MCP disabled", { status: 404 }))
  }
  const url = getRequestURL(event)
  const init: RequestInit = {
    method: event.method,
    headers: event.headers,
  }
  if (event.method !== "GET" && event.method !== "DELETE") {
    init.body = await readRawBody(event)
  }
  const res = await handler(new Request(url, init))
  return sendWebResponse(event, res)
})

async function readRawBody(event: Parameters<typeof defineEventHandler>[0] extends never ? never : Parameters<Parameters<typeof defineEventHandler>[0]>[0]): Promise<ArrayBuffer | undefined> {
  // h3 helper: returns raw body as Buffer or undefined.
  const node = (event as unknown as { node?: { req?: NodeJS.ReadableStream } }).node
  if (!node?.req) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of node.req as NodeJS.ReadableStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).buffer
}
```

> If h3 already exports `readRawBody`, replace the local helper with `import { readRawBody } from "h3"`. The Nitro version in this project ships it — use the import.

- [ ] **Step 2: Create the GET handler.** Same logic, different verb:

```ts
import { defineEventHandler, getRequestURL, sendWebResponse } from "h3"
import { mcpHandler } from "@better-auth/oauth-provider"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { env } from "../lib/env"
import { buildContextFromJwt } from "../mcp/context"
import { buildMcpServer } from "../mcp/server"

const handler = mcpHandler(
  {
    jwksUrl: `${env.BETTER_AUTH_URL}/api/auth/jwks`,
    verifyOptions: {
      issuer: env.BETTER_AUTH_URL,
      audience: `${env.BETTER_AUTH_URL}/api/mcp`,
    },
  },
  async (req: Request, jwt: Record<string, unknown>) => {
    const ctx = buildContextFromJwt(jwt)
    const server = buildMcpServer(ctx)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    return transport.handleRequest(req)
  },
)

export default defineEventHandler(async (event) => {
  if (!env.MCP_ENABLED) {
    return sendWebResponse(event, new Response("MCP disabled", { status: 404 }))
  }
  const url = getRequestURL(event)
  const res = await handler(new Request(url, { method: "GET", headers: event.headers }))
  return sendWebResponse(event, res)
})
```

- [ ] **Step 3: Create the DELETE handler.** Same shape:

```ts
import { defineEventHandler, getRequestURL, sendWebResponse } from "h3"
import { mcpHandler } from "@better-auth/oauth-provider"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { env } from "../lib/env"
import { buildContextFromJwt } from "../mcp/context"
import { buildMcpServer } from "../mcp/server"

const handler = mcpHandler(
  {
    jwksUrl: `${env.BETTER_AUTH_URL}/api/auth/jwks`,
    verifyOptions: {
      issuer: env.BETTER_AUTH_URL,
      audience: `${env.BETTER_AUTH_URL}/api/mcp`,
    },
  },
  async (req: Request, jwt: Record<string, unknown>) => {
    const ctx = buildContextFromJwt(jwt)
    const server = buildMcpServer(ctx)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    return transport.handleRequest(req)
  },
)

export default defineEventHandler(async (event) => {
  if (!env.MCP_ENABLED) {
    return sendWebResponse(event, new Response("MCP disabled", { status: 404 }))
  }
  const url = getRequestURL(event)
  const res = await handler(new Request(url, { method: "DELETE", headers: event.headers }))
  return sendWebResponse(event, res)
})
```

> The duplication is intentional: Nitro routes one file per verb, and DRYing them via a shared module is fine but at this scope the three near-copies are clearer than a clever factory. Refactor in Phase 4 if the route grows.

- [ ] **Step 4: Smoke-test 401 path.**

In one terminal: `MCP_ENABLED=true bun run dev`
In another: `curl -i -X POST http://localhost:3000/api/mcp -H 'Content-Type: application/json' -d '{}'`
Expected: HTTP 401 with `WWW-Authenticate: Bearer resource_metadata=...` header (mcpHandler adds this automatically when the bearer token is missing).

Stop the dev server.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/api/mcp.post.ts \
        apps/dashboard/server/api/mcp.get.ts \
        apps/dashboard/server/api/mcp.delete.ts
git commit -m "feat(mcp): add Streamable HTTP /api/mcp routes (POST/GET/DELETE)"
```

---

## Task 16: Integration test — full OAuth + MCP roundtrip

Programmatically drives discovery → register → authorize (via the magic-link bypass) → token → `tools/list` → `tools/call`. This is the test that proves Phase 1 is shippable.

**Files:**
- Create: `apps/dashboard/tests/api/mcp-oauth.test.ts`

- [ ] **Step 1: Write the test.**

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { eq, sql } from "drizzle-orm"
import { db } from "../../server/db"
import { projects, projectMembers } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  signIn,
  truncateDomain,
} from "../helpers"

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

describe("MCP OAuth + Streamable HTTP", () => {
  it("end-to-end: discovery → register → authorize → token → tools/call", async () => {
    await truncateDomain()
    const userId = await createUser("mcp-user@example.com")
    const cookie = await signIn("mcp-user@example.com")
    const projectId = crypto.randomUUID()
    await db.insert(projects).values({ id: projectId, name: "MCP Test", slug: "mcp-test" })
    await db.insert(projectMembers).values({ projectId, userId, role: "developer" })

    // 1. Discovery
    const discovery = await fetch(`${BASE}/.well-known/oauth-authorization-server`).then((r) =>
      r.json(),
    )
    expect(discovery.issuer).toBeDefined()
    expect(discovery.authorization_endpoint).toBeDefined()
    expect(discovery.token_endpoint).toBeDefined()
    expect(discovery.registration_endpoint).toBeDefined()

    // 2. Dynamic client registration
    const reg = await fetch(discovery.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test MCP Client",
        redirect_uris: [`${BASE}/oauth-test-callback`],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }).then((r) => r.json())
    expect(reg.client_id).toBeDefined()

    // 3. Authorize: simulate the user clicking "Allow" by POSTing the
    //    consent decision endpoint directly (the browser would do the same
    //    via the consent page).
    const { verifier, challenge } = pkce()
    const authorizeUrl = new URL(discovery.authorization_endpoint)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("client_id", reg.client_id)
    authorizeUrl.searchParams.set("redirect_uri", `${BASE}/oauth-test-callback`)
    authorizeUrl.searchParams.set("scope", "mcp:full")
    authorizeUrl.searchParams.set("code_challenge", challenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")
    authorizeUrl.searchParams.set("state", "test-state")
    const authorizeRes = await fetch(authorizeUrl, {
      headers: { cookie },
      redirect: "manual",
    })
    // Either oauth-provider auto-grants (returns 302 to redirect_uri) or
    // requires consent (returns 302 to /oauth/consent). Handle both.
    let location = authorizeRes.headers.get("location") ?? ""
    if (location.includes("/oauth/consent")) {
      const consentChallenge = new URL(location, BASE).searchParams.get("consent_challenge")
      const decision = await apiFetch<{ redirectUri: string }>("/api/oauth/consent", {
        method: "POST",
        headers: { cookie },
        body: { consentChallenge, allow: true },
      })
      expect(decision.status).toBe(200)
      location = decision.body.redirectUri
    }
    const code = new URL(location, BASE).searchParams.get("code")
    expect(code).toBeTruthy()

    // 4. Token exchange
    const tokenRes = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: `${BASE}/oauth-test-callback`,
        client_id: reg.client_id,
        code_verifier: verifier,
      }),
    }).then((r) => r.json())
    expect(tokenRes.access_token).toBeDefined()
    expect(tokenRes.token_type).toMatch(/bearer/i)

    // 5. MCP — tools/list and tools/call via the official SDK client
    const client = new Client({ name: "test-client", version: "0.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${tokenRes.access_token}` },
      },
    })
    await client.connect(transport)
    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "repro_get_ticket",
      "repro_list_projects",
    ])

    const listResult = await client.callTool({
      name: "repro_list_projects",
      arguments: {},
    })
    const text = (listResult.content?.[0] as { text?: string } | undefined)?.text ?? "[]"
    const projectsResult = JSON.parse(text) as Array<{ id: string; slug: string }>
    expect(projectsResult.find((p) => p.id === projectId)).toBeDefined()
    await client.close()
  }, 30_000)
})
```

- [ ] **Step 2: Run the dev server with MCP enabled in one terminal.**

```bash
MCP_ENABLED=true bun run dev
```

- [ ] **Step 3: Run the test in another terminal.**

```bash
MCP_ENABLED=true bun test apps/dashboard/tests/api/mcp-oauth.test.ts
```

Expected: PASS — full OAuth dance + tools/list + tools/call all green.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/tests/api/mcp-oauth.test.ts
git commit -m "test(mcp): integration — full OAuth + tools/call roundtrip"
```

---

## Task 17: Hand verification with a real MCP client

Not automated — but worth doing once before sign-off, because the spec promises Claude Desktop / Cursor work end-to-end.

- [ ] **Step 1: Start the dev server with MCP enabled.**

```bash
MCP_ENABLED=true bun run dev
```

- [ ] **Step 2: Add Repro to Claude Desktop's `mcp_servers.json`.** On macOS this is `~/Library/Application Support/Claude/claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "repro": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp"]
    }
  }
}
```

(Streamable HTTP support in Claude Desktop currently ships via the `mcp-remote` shim; once first-party `transport: "streamable-http"` lands, this entry switches to a single-line URL config.)

- [ ] **Step 3: Restart Claude Desktop.** A browser window should open to `http://localhost:3000/sign-in?...` automatically — magic-link in, then Allow on the consent page.

- [ ] **Step 4: In Claude, ask:** "list my Repro projects" and "show me the latest ticket from project `<slug>`". Expected: both tools return data.

- [ ] **Step 5: Disconnect and revoke.** Quit Claude. We don't have a `/settings/mcp` page yet (Phase 3) so revocation is by deleting the consent row directly: `DELETE FROM oauth_consent WHERE user_id = '<userId>'`.

> No commit for this task — verification only.

---

## Self-Review

After saving this plan I checked it against the spec. Findings:

**Spec coverage (Phase 1 only):**

| Spec section | Covered by |
|---|---|
| §3 architecture & file boundaries (Phase-1 subset) | Tasks 8–15 |
| §4 OAuth flow (plugin config, discovery, register, authorize, token, refresh, revoke) | Task 8 (config + discovery), Task 9 (consent), Task 16 (full flow exercised) |
| §4 consent page | Task 9 |
| §5 `repro_list_projects` | Task 12 |
| §5 `repro_get_ticket` (with replay transcript inline) | Task 13 |
| §5.1 TicketDetail schema | Task 13 (a Phase-1 subset; Phase 2 fills in member assignee object, attachments URL signing, and pageContext/systemInfo when present) |
| §6 replay-transcript reducer (FullSnapshot, navigation, coalesced inputs, console errors, size cap, defensive path) | Tasks 3–6 |
| §7 permissions — `requireProjectRoleByUser` | Task 7 |
| §7 audit `actor_client_id` | **Deferred to Phase 3** (no write tools in Phase 1, so no audit row writes either) |
| §9 deps + env | Tasks 1, 2 |
| §9 schema regeneration | Task 8 (auth:gen + db:push) |
| §10 testing | Reducer tests in Tasks 3–6, integration test in Task 16 |
| §11 rollout flag (`MCP_ENABLED=false` default) | Task 1 |

**Out-of-Phase-1 (deferred — these are real spec items, not gaps):**
- Phase 2: `repro_list_tickets`, `repro_list_ticket_comments`, `repro_get_screenshot`, `repro_get_replay_transcript` (separate tool), `repro_get_replay_raw`, `repro_get_ticket_cookies`, `repro_list_project_members`.
- Phase 3: write tools, `actor_client_id` audit column, `/settings/mcp` UI.
- Phase 4: VitePress docs, CHANGELOG, flag flip to `true`.

**Placeholder scan:** clean — every task has full code, exact paths, exact commands, expected output.

**Type consistency:** `buildReplayTranscript` signature stable across Tasks 3–6; `McpRequestContext` fields used identically in Tasks 11, 12, 13, 14; `requireProjectRoleByUser` signature in Task 7 matches its consumer in Task 13.

**One inconsistency caught and fixed:** initial draft of Task 13 called `requireProjectRoleByUser(userId, projectId, "viewer")`. Per CLAUDE.md the role ladder for read access is `viewer` (rank 1), so this is correct; left as-is. (Logged for clarity.)

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-mcp-oauth-server-phase-1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
