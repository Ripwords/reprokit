// apps/dashboard/server/api/admin/overview.get.ts
import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm"
import { defineEventHandler } from "h3"
import type { AdminOverviewDTO } from "@reprojs/shared"
import { db } from "../../db"
import { githubIntegrations, projects, reportEvents, reports, user } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

const DAY_MS = 86_400_000
const VOLUME_DAYS = 7
const TREND_DAYS = 30

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export default defineEventHandler(async (event): Promise<AdminOverviewDTO> => {
  await requireInstallAdmin(event)

  const now = new Date()
  const today = startOfUtcDay(now)
  const sevenDaysAgo = new Date(today.getTime() - (VOLUME_DAYS - 1) * DAY_MS)
  const trendStart = new Date(today.getTime() - (TREND_DAYS - 1) * DAY_MS)

  const [
    totalRows,
    statusCounts,
    priorityCounts,
    last7Rows,
    projectsTotalRows,
    projectsWithGithubRows,
    recentReportRows,
    recentEventRows,
    perProjectRows,
    volumeRows,
  ] = await Promise.all([
    // 1. Total reports across install (ignoring deleted projects).
    db
      .select({ total: count() })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(isNull(projects.deletedAt)),

    // 2. Status breakdown.
    db
      .select({ key: reports.status, c: count() })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(isNull(projects.deletedAt))
      .groupBy(reports.status),

    // 3. Priority breakdown.
    db
      .select({ key: reports.priority, c: count() })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(isNull(projects.deletedAt))
      .groupBy(reports.priority),

    // 4. New in the last 7 days.
    db
      .select({ last7: count() })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(and(isNull(projects.deletedAt), gte(reports.createdAt, sevenDaysAgo))),

    // 5. Projects count (non-deleted).
    db.select({ total: count() }).from(projects).where(isNull(projects.deletedAt)),

    // 6. Projects with a connected GitHub integration.
    db
      .select({ withGithub: count() })
      .from(githubIntegrations)
      .innerJoin(projects, eq(projects.id, githubIntegrations.projectId))
      .where(and(isNull(projects.deletedAt), eq(githubIntegrations.status, "connected"))),

    // 7. 10 most recent reports, newest first, with project name. Purpose-
    //    built narrow projection for AdminRecentReportDTO (not the full
    //    ReportSummaryDTO — the admin row only renders title + priority +
    //    project + timestamp).
    db
      .select({
        id: reports.id,
        projectId: reports.projectId,
        projectName: projects.name,
        title: reports.title,
        status: reports.status,
        priority: reports.priority,
        receivedAt: reports.createdAt,
      })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(isNull(projects.deletedAt))
      .orderBy(desc(reports.createdAt))
      .limit(10),

    // 8. 10 most recent events across all projects. Uses the composite
    //    (project_id, created_at DESC) index on report_events.
    db
      .select({
        id: reportEvents.id,
        reportId: reportEvents.reportId,
        reportTitle: reports.title,
        projectId: reports.projectId,
        projectName: projects.name,
        kind: reportEvents.kind,
        payload: reportEvents.payload,
        actorId: reportEvents.actorId,
        actorEmail: user.email,
        actorName: user.name,
        createdAt: reportEvents.createdAt,
      })
      .from(reportEvents)
      .innerJoin(reports, eq(reports.id, reportEvents.reportId))
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .leftJoin(user, eq(user.id, reportEvents.actorId))
      .where(isNull(projects.deletedAt))
      .orderBy(desc(reportEvents.createdAt))
      .limit(10),

    // 9. Per-project breakdown — one row per project with open / new7d / total
    //    counts. LEFT JOIN ensures projects with zero reports still appear.
    db
      .select({
        id: projects.id,
        name: projects.name,
        totalCount: sql<number>`coalesce(count(${reports.id}), 0)::int`,
        openCount: sql<number>`coalesce(sum(case when ${reports.status} = 'open' then 1 else 0 end), 0)::int`,
        newLast7Count: sql<number>`coalesce(sum(case when ${reports.createdAt} >= ${sevenDaysAgo} then 1 else 0 end), 0)::int`,
      })
      .from(projects)
      .leftJoin(reports, eq(reports.projectId, projects.id))
      .where(isNull(projects.deletedAt))
      .groupBy(projects.id, projects.name)
      .orderBy(
        sql`coalesce(sum(case when ${reports.status} = 'open' then 1 else 0 end), 0) desc`,
        projects.name,
      ),

    // 10. Daily report volume for the last TREND_DAYS, grouped by UTC day.
    //     Counts only non-deleted projects. Sparse — days with zero reports
    //     are absent here and get zero-filled in JS below.
    db
      .select({
        day: sql<string>`to_char(${reports.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        c: count(),
      })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(and(isNull(projects.deletedAt), gte(reports.createdAt, trendStart)))
      .groupBy(sql`1`),
  ])

  const total = totalRows[0]?.total ?? 0
  const last7 = last7Rows[0]?.last7 ?? 0
  const projectsTotal = projectsTotalRows[0]?.total ?? 0
  const projectsWithGithub = projectsWithGithubRows[0]?.withGithub ?? 0

  const byStatus = { open: 0, in_progress: 0, resolved: 0, closed: 0 } as Record<string, number>
  for (const r of statusCounts) byStatus[r.key] = r.c

  const byPriority = { urgent: 0, high: 0, normal: 0, low: 0 } as Record<string, number>
  for (const r of priorityCounts) byPriority[r.key] = r.c

  // Zero-fill: every UTC day from trendStart..today inclusive must appear,
  // ordered oldest → newest. `trendStart` is UTC midnight, so slicing the
  // ISO string yields the correct YYYY-MM-DD day key.
  const volumeByDay = new Map(volumeRows.map((r) => [r.day, r.c]))
  const volume = Array.from({ length: TREND_DAYS }, (_, i) => {
    const date = new Date(trendStart.getTime() + i * DAY_MS).toISOString().slice(0, 10)
    return { date, count: volumeByDay.get(date) ?? 0 }
  })

  return {
    counts: {
      total,
      byStatus: byStatus as AdminOverviewDTO["counts"]["byStatus"],
      byPriority: byPriority as AdminOverviewDTO["counts"]["byPriority"],
      last7Days: last7,
    },
    projects: {
      total: projectsTotal,
      withGithub: projectsWithGithub,
    },
    recentReports: recentReportRows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      title: r.title,
      status: r.status as AdminOverviewDTO["recentReports"][number]["status"],
      priority: r.priority as AdminOverviewDTO["recentReports"][number]["priority"],
      receivedAt: r.receivedAt.toISOString(),
    })),
    recentEvents: recentEventRows.map((e) => ({
      id: e.id,
      reportId: e.reportId,
      reportTitle: e.reportTitle,
      projectId: e.projectId,
      projectName: e.projectName,
      kind: e.kind as AdminOverviewDTO["recentEvents"][number]["kind"],
      payload: e.payload as Record<string, unknown>,
      actor: e.actorId
        ? { id: e.actorId, email: e.actorEmail ?? "", name: e.actorName ?? null }
        : null,
      createdAt: e.createdAt.toISOString(),
    })),
    perProject: perProjectRows.map((r) => ({
      id: r.id,
      name: r.name,
      openCount: r.openCount,
      newLast7Count: r.newLast7Count,
      totalCount: r.totalCount,
    })),
    volume,
  }
})
