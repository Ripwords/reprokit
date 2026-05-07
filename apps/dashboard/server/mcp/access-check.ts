import { eq } from "drizzle-orm"
import { createError } from "h3"
import { db } from "../db"
import { appSettings, user } from "../db/schema"

/**
 * Per-MCP-request access check. Called inside the mcpHandler callback (after
 * JWT signature verify) so we don't run unnecessary DB reads on unauthenticated
 * requests.
 *
 * Throws via h3 createError on:
 *   - 401 if the user record is missing (defense-in-depth — JWT was signed by us,
 *     so the user should exist; but a deleted user mid-token-life should not get
 *     access)
 *   - 403 if the user's status is "disabled"
 *   - 403 if the workspace's email-domain allowlist is non-empty AND the user's
 *     email domain is not on it (post-hoc allowlist tightening case)
 *
 * This closes the spec §7 threat-3 gap: refresh-token rotation bakes the JWT
 * once an hour, but `oauth-provider` does not consult any allowlist hook on
 * refresh. Checking on every MCP request is one indexed lookup; cheap.
 */
export async function assertMcpUserAllowed(userId: string): Promise<void> {
  const [u] = await db
    .select({ status: user.status, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!u) {
    throw createError({ statusCode: 401, statusMessage: "User no longer exists" })
  }
  if (u.status === "disabled") {
    throw createError({ statusCode: 403, statusMessage: "Account is disabled" })
  }
  const [settings] = await db.select().from(appSettings).limit(1)
  if (settings && settings.allowedEmailDomains.length > 0) {
    const domain = u.email.toLowerCase().split("@")[1] ?? ""
    if (!settings.allowedEmailDomains.includes(domain)) {
      throw createError({
        statusCode: 403,
        statusMessage: "Email domain is no longer on the workspace allowlist",
      })
    }
  }
}
