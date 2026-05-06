import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { sql } from "drizzle-orm"
import { db } from "../db"
import { projects, projectMembers, user } from "../db/schema"
import { compareRole, requireProjectRoleByUser, type ProjectRoleName } from "./permissions"

describe("compareRole", () => {
  const roles: ProjectRoleName[] = ["viewer", "manager", "developer", "owner"]

  test("owner satisfies all minimums", () => {
    for (const min of roles) {
      expect(compareRole("owner", min)).toBe(true)
    }
  })

  test("developer satisfies developer, manager, and viewer, not owner", () => {
    expect(compareRole("developer", "viewer")).toBe(true)
    expect(compareRole("developer", "manager")).toBe(true)
    expect(compareRole("developer", "developer")).toBe(true)
    expect(compareRole("developer", "owner")).toBe(false)
  })

  test("manager satisfies manager and viewer, not developer or owner", () => {
    expect(compareRole("manager", "viewer")).toBe(true)
    expect(compareRole("manager", "manager")).toBe(true)
    expect(compareRole("manager", "developer")).toBe(false)
    expect(compareRole("manager", "owner")).toBe(false)
  })

  test("viewer satisfies only viewer", () => {
    expect(compareRole("viewer", "viewer")).toBe(true)
    expect(compareRole("viewer", "manager")).toBe(false)
    expect(compareRole("viewer", "developer")).toBe(false)
    expect(compareRole("viewer", "owner")).toBe(false)
  })
})

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
  await db.insert(projects).values({ id: projectId, name: "p", createdBy: userId })
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
  await db.insert(projects).values({ id: projectId, name: "p", createdBy: userId })
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
  await db.insert(projects).values({ id: projectId, name: "p", createdBy: userId })

  await expect(requireProjectRoleByUser(userId, projectId, "viewer")).rejects.toThrow(/not found/i)
})
