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
