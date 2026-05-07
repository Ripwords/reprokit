import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { sql } from "drizzle-orm"
import { randomBytes } from "node:crypto"
import { db } from "../db"
import { appSettings, user } from "../db/schema"
import { assertMcpUserAllowed } from "./access-check"

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" RESTART IDENTITY CASCADE`)
  await db
    .update(appSettings)
    .set({ allowedEmailDomains: [] })
    .where(sql`true`)
})

afterAll(async () => {
  await db
    .update(appSettings)
    .set({ allowedEmailDomains: [] })
    .where(sql`true`)
})

async function seedUser(opts: {
  email: string
  status?: "active" | "invited" | "disabled"
}): Promise<string> {
  const id = randomBytes(16).toString("hex")
  await db.insert(user).values({
    id,
    email: opts.email,
    name: opts.email,
    emailVerified: true,
    role: "member",
    status: opts.status ?? "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

describe("assertMcpUserAllowed", () => {
  it("passes for an active user with empty allowlist", async () => {
    const userId = await seedUser({ email: "alice@example.com" })
    await expect(assertMcpUserAllowed(userId)).resolves.toBeUndefined()
  })

  it("throws for a disabled user", async () => {
    const userId = await seedUser({ email: "alice@example.com", status: "disabled" })
    await expect(assertMcpUserAllowed(userId)).rejects.toThrow(/disabled|FORBIDDEN/i)
  })

  it("throws when user record is missing", async () => {
    await expect(assertMcpUserAllowed("nonexistent")).rejects.toThrow()
  })

  it("throws when user's domain is no longer on the allowlist", async () => {
    const userId = await seedUser({ email: "alice@example.com" })
    await db
      .update(appSettings)
      .set({ allowedEmailDomains: ["other-domain.com"] })
      .where(sql`true`)
    await expect(assertMcpUserAllowed(userId)).rejects.toThrow(/domain|allowlist|FORBIDDEN/i)
  })

  it("passes when user's domain is on the allowlist", async () => {
    const userId = await seedUser({ email: "alice@example.com" })
    await db
      .update(appSettings)
      .set({ allowedEmailDomains: ["example.com"] })
      .where(sql`true`)
    await expect(assertMcpUserAllowed(userId)).resolves.toBeUndefined()
  })
})
