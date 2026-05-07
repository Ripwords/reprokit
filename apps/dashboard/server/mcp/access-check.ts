import { eq } from "drizzle-orm"
import { createError } from "h3"
import { db } from "../db"
import { user, appSettings } from "../db/schema"
import { createPgRateLimiter } from "../lib/rate-limit-pg"
import { env } from "../lib/env"

interface RateLimitOptions {
  perMinute: number
}

export interface McpAccessChecker {
  assert(userId: string): Promise<void>
}

interface MakeOptions {
  rateLimit?: RateLimitOptions
}

/**
 * Per-MCP-request access check factory.
 *
 * Called inside the mcpHandler callback (after JWT signature verify) to:
 *   1. Apply a per-user rate limit (default 600/min, env-tunable).
 *   2. Verify the user record still exists.
 *   3. Reject disabled users.
 *   4. Reject users whose email domain has fallen off the workspace allowlist
 *      after the JWT was issued — this closes the spec §7 threat-3 gap that
 *      `oauth-provider` doesn't expose a refresh-time hook for.
 *
 * Throws via h3 createError on failure:
 *   - 429 if rate-limited (Retry-After hint in statusMessage)
 *   - 401 if user record is missing
 *   - 403 if status === "disabled" or domain not allowlisted
 */
export function makeMcpAccessChecker(opts: MakeOptions = {}): McpAccessChecker {
  const limiter = createPgRateLimiter({
    perMinute: opts.rateLimit?.perMinute ?? env.MCP_RATE_LIMIT_PER_USER_PER_MINUTE,
  })

  return {
    async assert(userId: string): Promise<void> {
      // Rate limit FIRST — a user hammering MCP shouldn't get DB lookups before
      // their request gets shed.
      const take = await limiter.take(`mcp:user:${userId}`)
      if (!take.allowed) {
        throw createError({
          statusCode: 429,
          statusMessage: `MCP rate limit exceeded; retry in ${Math.ceil(take.retryAfterMs / 1000)}s`,
        })
      }

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
    },
  }
}

export const defaultMcpAccessChecker = makeMcpAccessChecker()
