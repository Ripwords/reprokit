import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db"
import { projectMembers, user } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import type { McpRequestContext } from "../context"

export const listProjectMembersTool = {
  name: "repro_list_project_members",
  config: {
    description:
      "List dashboard members of a Repro project — the people who can read or triage tickets in it. Each member has a role (viewer / manager / developer / owner). Note: ticket assignees are GitHub logins, distinct from dashboard members.",
    inputSchema: z.object({
      projectId: z.string().uuid(),
    }),
  },
  handler: async (input: { projectId: string }, ctx: McpRequestContext) => {
    await requireProjectRoleByUser(ctx.userId, input.projectId, "viewer")

    const rows = await db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, input.projectId))

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            rows.map((m) => ({
              userId: m.userId,
              name: m.name,
              email: m.email,
              projectRole: m.role,
            })),
            null,
            2,
          ),
        },
      ],
    }
  },
}
