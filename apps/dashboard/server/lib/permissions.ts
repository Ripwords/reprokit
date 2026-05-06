import { and, eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { createError } from "h3"
import { db } from "../db"
import { projectMembers, user } from "../db/schema"
import { auth } from "./auth"

export type ProjectRoleName = "viewer" | "manager" | "developer" | "owner"

const ROLE_RANK: Record<ProjectRoleName, number> = {
  viewer: 1,
  manager: 2,
  developer: 3,
  owner: 4,
}

export function compareRole(actual: ProjectRoleName, min: ProjectRoleName): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min]
}

export interface AppSession {
  userId: string
  email: string
  role: "admin" | "member"
  status: "active" | "invited" | "disabled"
}

// Type-level: better-auth's $Infer surfaces the full user shape including our
// configured `additionalFields` (role/status). getSession()'s return type, for
// reasons internal to better-auth, narrows to the core fields only — but the
// runtime value IS the full shape. Bridge with a type assertion against the
// $Infer type (which is authoritative, driven by auth.ts). If auth.ts ever
// renames a field, TypeScript catches the drift here instead of silently
// producing `undefined` at the usage site.
type InferredUser = typeof auth.$Infer.Session.user

export async function requireSession(event: H3Event): Promise<AppSession> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" })
  }
  const u = session.user as InferredUser
  if (u.status === "disabled") {
    throw createError({ statusCode: 403, statusMessage: "Account disabled" })
  }
  return {
    userId: u.id,
    email: u.email,
    role: u.role as AppSession["role"],
    status: u.status as AppSession["status"],
  }
}

export async function requireInstallAdmin(event: H3Event): Promise<AppSession> {
  const session = await requireSession(event)
  if (session.role !== "admin") {
    throw createError({ statusCode: 403, statusMessage: "Admin only" })
  }
  return session
}

export async function requireProjectRole(
  event: H3Event,
  projectId: string,
  min: ProjectRoleName,
): Promise<{ session: AppSession; effectiveRole: ProjectRoleName }> {
  const session = await requireSession(event)
  if (session.role === "admin") {
    return { session, effectiveRole: "owner" }
  }
  const [member] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, session.userId)))
    .limit(1)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" })
  }
  if (!compareRole(member.role as ProjectRoleName, min)) {
    throw createError({ statusCode: 403, statusMessage: "Insufficient role" })
  }
  return { session, effectiveRole: member.role as ProjectRoleName }
}

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
  const [userRow] = await db
    .select({ role: user.role, status: user.status })
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
