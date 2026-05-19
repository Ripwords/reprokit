import { setup } from "../nuxt-setup"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { AdminOverviewDTO } from "@reprojs/shared"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers, projects, reports } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(60000)

async function submitReport(publicKey: string, title: string, origin: string): Promise<string> {
  const fd = new FormData()
  fd.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: publicKey,
          title,
          description: "d",
          context: {
            pageUrl: `${origin}/p`,
            userAgent: "UA",
            viewport: { w: 1000, h: 800 },
            timestamp: new Date().toISOString(),
            reporter: { email: "u@example.com" },
          },
          _dwellMs: 2000,
        }),
      ],
      { type: "application/json" },
    ),
  )
  fd.set("screenshot", makePngBlob(), "s.png")
  const res = await fetch("http://localhost:3000/api/intake/reports", {
    method: "POST",
    headers: { Origin: origin },
    body: fd,
  })
  if (res.status !== 201) throw new Error(`intake failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

describe("GET /api/admin/overview", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateGithub()
    await truncateDomain()
  })

  test("non-admin gets 403 even if they own projects", async () => {
    const memberId = await createUser("member@example.com", "member")
    const projectId = await seedProject({
      name: "Mine",
      publicKey: "rp_pk_OWNER0000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: memberId,
    })
    await db.insert(projectMembers).values({ projectId, userId: memberId, role: "owner" })
    const cookie = await signIn("member@example.com")

    const { status } = await apiFetch("/api/admin/overview", { headers: { cookie } })
    expect(status).toBe(403)
  })

  test("admin gets aggregated counts across all projects", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const pA = await seedProject({
      name: "Alpha",
      publicKey: "rp_pk_ALPHA0000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    const pB = await seedProject({
      name: "Bravo",
      publicKey: "rp_pk_BRAVO0000000000000000000",
      allowedOrigins: ["http://localhost:4001"],
      createdBy: adminId,
    })
    // Seed 2 reports in Alpha, 1 in Bravo — all default to status=open.
    await submitReport("rp_pk_ALPHA0000000000000000000", "a1", "http://localhost:4000")
    await submitReport("rp_pk_ALPHA0000000000000000000", "a2", "http://localhost:4000")
    await submitReport("rp_pk_BRAVO0000000000000000000", "b1", "http://localhost:4001")

    // Attach a connected github integration to Alpha only.
    await db.insert(githubIntegrations).values({
      projectId: pA,
      installationId: 1,
      repoOwner: "acme",
      repoName: "alpha",
      status: "connected",
    })

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    expect(body.counts.total).toBe(3)
    expect(body.counts.byStatus.open).toBe(3)
    expect(body.counts.last7Days).toBe(3)
    expect(body.projects.total).toBe(2)
    expect(body.projects.withGithub).toBe(1)

    // recentReports: newest-first across projects
    expect(body.recentReports.length).toBe(3)
    expect(body.recentReports[0]?.title).toBe("b1")
    expect(body.recentReports[0]?.projectId).toBe(pB)
    expect(body.recentReports[0]?.projectName).toBe("Bravo")

    // perProject: sorted by openCount desc, then name asc. Alpha has 2 open, Bravo 1.
    expect(body.perProject.map((p) => p.name)).toEqual(["Alpha", "Bravo"])
    expect(body.perProject[0]).toMatchObject({
      id: pA,
      name: "Alpha",
      openCount: 2,
      totalCount: 2,
    })
    expect(body.perProject[1]).toMatchObject({
      id: pB,
      name: "Bravo",
      openCount: 1,
      totalCount: 1,
    })
  })

  test("admin gets empty shape on empty install", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    expect(body.counts.total).toBe(0)
    expect(body.counts.last7Days).toBe(0)
    expect(body.projects.total).toBe(0)
    expect(body.projects.withGithub).toBe(0)
    expect(body.recentReports).toEqual([])
    expect(body.recentEvents).toEqual([])
    expect(body.perProject).toEqual([])
    expect(body.volume.length).toBe(30)
    expect(body.volume.every((v) => v.count === 0)).toBe(true)
  })

  test("recentReports caps at 10", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Big",
      publicKey: "rp_pk_BIGGGG000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    // Seed 12 reports directly via Drizzle to bypass the intake rate-limiter.
    // The admin overview endpoint just reads from the reports table; going
    // through the intake is orthogonal for this cap-check.
    const now = Date.now()
    await db.insert(reports).values(
      Array.from({ length: 12 }, (_, i) => ({
        projectId,
        title: `r${i}`,
        description: null,
        context: {
          pageUrl: "http://localhost:4000/p",
          userAgent: "UA",
          viewport: { w: 1000, h: 800 },
          timestamp: new Date(now + i).toISOString(),
        },
        // Space createdAt by 1ms per row so ordering is deterministic.
        createdAt: new Date(now + i),
      })),
    )
    const cookie = await signIn("admin@example.com")
    const { body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(body.recentReports.length).toBe(10)
    expect(body.counts.total).toBe(12)
  })

  test("volume is a 30-day zero-filled UTC series, newest last, excludes deleted projects", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const live = await seedProject({
      name: "Live",
      publicKey: "rp_pk_LIVEVOL00000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    const dead = await seedProject({
      name: "Dead",
      publicKey: "rp_pk_DEADVOL00000000000000000",
      allowedOrigins: ["http://localhost:4001"],
      createdBy: adminId,
    })

    const DAY = 86_400_000
    const now = Date.now()
    const utcMidnight = (msAgoDays: number) => {
      const d = new Date(now - msAgoDays * DAY)
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12))
    }
    const ctx = {
      pageUrl: "http://localhost:4000/p",
      userAgent: "UA",
      viewport: { w: 1000, h: 800 },
      timestamp: new Date().toISOString(),
    }

    await db.insert(reports).values([
      { projectId: live, title: "t1", description: null, context: ctx, createdAt: utcMidnight(0) },
      { projectId: live, title: "t2", description: null, context: ctx, createdAt: utcMidnight(0) },
      { projectId: live, title: "t3", description: null, context: ctx, createdAt: utcMidnight(3) },
    ])
    await db.insert(reports).values(
      Array.from({ length: 5 }, (_, i) => ({
        projectId: dead,
        title: `d${i}`,
        description: null,
        context: ctx,
        createdAt: utcMidnight(0),
      })),
    )
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, dead))

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(status).toBe(200)

    expect(body.volume.length).toBe(30)
    for (let i = 1; i < body.volume.length; i++) {
      const prev = new Date(`${body.volume[i - 1]!.date}T00:00:00Z`).getTime()
      const cur = new Date(`${body.volume[i]!.date}T00:00:00Z`).getTime()
      expect(cur - prev).toBe(DAY)
    }

    // Anchor on the response's own last day to avoid a 00:00-UTC race
    // between capturing `now` and the server handling the request.
    const todayStr = body.volume[body.volume.length - 1]!.date
    const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime()
    const day3Str = new Date(todayMs - 3 * DAY).toISOString().slice(0, 10)
    const day10Str = new Date(todayMs - 10 * DAY).toISOString().slice(0, 10)
    const byDate = Object.fromEntries(body.volume.map((v) => [v.date, v.count]))

    expect(byDate[todayStr]).toBe(2)
    expect(byDate[day3Str]).toBe(1)
    expect(byDate[day10Str]).toBe(0)
  })
})

describe("GET /api/projects", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("GET /api/projects excludes soft-deleted projects", async () => {
    const adminId = await createUser("padmin@example.com", "admin")
    const keep = await seedProject({
      name: "Keep",
      publicKey: "rp_pk_KEEPPRJ00000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    const gone = await seedProject({
      name: "Gone",
      publicKey: "rp_pk_GONEPRJ00000000000000000",
      allowedOrigins: ["http://localhost:4001"],
      createdBy: adminId,
    })
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, gone))

    const cookie = await signIn("padmin@example.com")
    const { status, body } = await apiFetch<Array<{ id: string }>>("/api/projects", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    const ids = body.map((p) => p.id)
    expect(ids).toContain(keep)
    expect(ids).not.toContain(gone)
  })
})
