import { defineEventHandler } from "h3"
import { eq, desc, max } from "drizzle-orm"
import { db } from "../../db"
import { oauthConsent, oauthClient, oauthAccessToken } from "../../db/schema/auth-schema"
import { requireSession } from "../../lib/permissions"

/**
 * Returns the OAuth consents (= connected MCP apps) for the current user.
 * Each entry includes the client name (from RFC 7591 registration), connected
 * date, last-used timestamp, and the scopes granted.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event)

  const consents = await db
    .select({
      clientId: oauthConsent.clientId,
      scopes: oauthConsent.scopes,
      createdAt: oauthConsent.createdAt,
      clientName: oauthClient.name,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, session.userId))
    .orderBy(desc(oauthConsent.createdAt))

  // Last-used per client = latest access token's createdAt for that (user, client) pair.
  // One query: max(createdAt) per (userId, clientId). Scopes by userId so a
  // shared client_id between users doesn't leak each other's last-used.
  const lastUsedRows = await db
    .select({
      clientId: oauthAccessToken.clientId,
      lastUsedAt: max(oauthAccessToken.createdAt),
    })
    .from(oauthAccessToken)
    .where(eq(oauthAccessToken.userId, session.userId))
    .groupBy(oauthAccessToken.clientId)

  const lastUsedByClient = new Map<string, Date>()
  for (const row of lastUsedRows) {
    if (row.lastUsedAt) lastUsedByClient.set(row.clientId, row.lastUsedAt)
  }

  return {
    connections: consents.map((c) => ({
      clientId: c.clientId,
      clientName: c.clientName ?? "Unknown",
      scopes: c.scopes ?? [],
      connectedAt: c.createdAt,
      lastUsedAt: lastUsedByClient.get(c.clientId) ?? null,
    })),
  }
})
