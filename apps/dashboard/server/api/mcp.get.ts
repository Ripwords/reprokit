import { defineEventHandler, getRequestURL, sendWebResponse } from "h3"
import { mcpHandler } from "@better-auth/oauth-provider"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { env } from "../lib/env"
import { buildContextFromJwt } from "../mcp/context"
import { buildMcpServer } from "../mcp/server"
import { defaultMcpAccessChecker } from "../mcp/access-check"

// better-auth mounts the auth handler at /api/auth, so the JWT issuer is
// BETTER_AUTH_URL + "/api/auth" (better-auth sets iss = ctx.context.baseURL,
// and baseURL in auth.ts is configured as env.BETTER_AUTH_URL which Nitro
// then appends "/api/auth" to during the handler registration).
const ISSUER = `${env.BETTER_AUTH_URL}/api/auth`

const handler = mcpHandler(
  {
    jwksUrl: `${env.BETTER_AUTH_URL}/api/auth/jwks`,
    verifyOptions: {
      issuer: ISSUER,
      audience: `${env.BETTER_AUTH_URL}/api/mcp`,
    },
  },
  async (req: Request, jwt: Record<string, unknown>) => {
    const ctx = buildContextFromJwt(jwt)
    await defaultMcpAccessChecker.assert(ctx.userId)
    const server = buildMcpServer(ctx)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
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
