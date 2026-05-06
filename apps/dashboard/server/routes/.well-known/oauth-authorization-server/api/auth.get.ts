/**
 * RFC 8414 OAuth Authorization Server Metadata discovery endpoint.
 *
 * Better-auth's oauthProvider plugin registers /.well-known/oauth-authorization-server
 * relative to the auth handler's own base path (/api/auth). The standard location
 * required by RFC 8414 for an issuer at /api/auth is:
 *   /.well-known/oauth-authorization-server/api/auth
 *
 * Nuxt 4 does not route paths starting with '.' through the [...].ts API catch-all,
 * so we expose this endpoint as a Nitro server/routes file (which Nitro handles
 * directly without Vue Router involvement).
 *
 * Only registered when MCP_ENABLED=true — when false the oauthProvider plugin is
 * not loaded, so auth.api.getOAuthServerConfig would not exist.
 */
import { defineEventHandler, setResponseHeader, send } from "h3"
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider"
import { auth } from "../../../../lib/auth"
import { env } from "../../../../lib/env"

export default defineEventHandler(async (event) => {
  if (!env.MCP_ENABLED) {
    event.node.res.statusCode = 404
    return null
  }

  const handler = oauthProviderAuthServerMetadata(auth)
  const req = event.node.req
  const url = `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}${req.url}`
  const response = await handler(
    new Request(url, { method: "GET", headers: req.headers as HeadersInit }),
  )

  event.node.res.statusCode = response.status
  response.headers.forEach((value, key) => {
    setResponseHeader(event, key, value)
  })
  const body = await response.text()
  return send(event, body, response.headers.get("content-type") ?? "application/json")
})
