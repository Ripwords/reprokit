<script setup lang="ts">
import { Orientation } from "@unovis/ts"
import type { AdminOverviewDTO } from "@reprojs/shared"
import AppEmptyState from "~/components/common/app-empty-state.vue"
import { priorityColor, relativeTime } from "~/composables/use-report-format"

definePageMeta({ middleware: "admin-only" })
useHead({ title: "Admin overview" })

const { data: overview } = await useApi<AdminOverviewDTO>("/api/admin/overview")

const metrics = computed(() => {
  const o = overview.value
  if (!o) return null
  return {
    open: o.counts.byStatus.open ?? 0,
    newThisWeek: o.counts.last7Days,
    total: o.counts.total,
    projects: o.projects.total,
    projectsWithGithub: o.projects.withGithub,
  }
})

const recentReports = computed(() => overview.value?.recentReports ?? [])
const recentActivity = computed(() => overview.value?.recentEvents ?? [])
const perProject = computed(() => overview.value?.perProject ?? [])
const projectCount = computed(() => overview.value?.projects.total ?? 0)

// ── Chart data ───────────────────────────────────────────────────────────
// Theme-aligned hex (charts need concrete colours, not Tailwind tokens).
const C = {
  primary: "#6366f1",
  open: "#3b82f6",
  inProgress: "#f59e0b",
  resolved: "#22c55e",
  closed: "#94a3b8",
} as const

const volume = computed(() => overview.value?.volume ?? [])
const hasVolume = computed(() => volume.value.some((v) => v.count > 0))
const volumeCategories = { count: { name: "Reports", color: C.primary } }
// vue-chrts axis formatter's first arg is the tick value; for the ordinal
// x-scale that equals the data-array index. Map it back to a short MM-DD label.
const volumeXFormatter = (tick: number): string => {
  const d = volume.value[tick]?.date
  return d ? d.slice(5) : ""
}

const statusCounts = computed(() => overview.value?.counts.byStatus)
const STATUS_ORDER = ["open", "in_progress", "resolved", "closed"] as const
const statusData = computed<number[]>(() => STATUS_ORDER.map((s) => statusCounts.value?.[s] ?? 0))
const hasStatus = computed(() => statusData.value.some((n) => n > 0))
// DonutChart takes a number[] aligned by ORDER to these category entries
// (STATUS_ORDER); the keys here only label the legend, they don't map data.
const statusCategories = {
  Open: { name: "Open", color: C.open },
  "In progress": { name: "In progress", color: C.inProgress },
  Resolved: { name: "Resolved", color: C.resolved },
  Closed: { name: "Closed", color: C.closed },
}

const topProjects = computed(() =>
  perProject.value
    .toSorted((a, b) => b.openCount - a.openCount)
    .slice(0, 8)
    .map((p) => ({ project: p.name, open: p.openCount })),
)
const hasTopProjects = computed(() => topProjects.value.some((p) => p.open > 0))
const topProjectsCategories = { open: { name: "Open reports", color: C.open } }
// Horizontal bars put the category on the Y axis, so the index→label
// formatter must be the Y formatter (the X axis is the numeric value).
const topProjectsYFormatter = (tick: number): string => topProjects.value[tick]?.project ?? ""

const EVENT_LABEL: Record<string, string> = {
  status_changed: "changed status",
  priority_changed: "changed priority",
  assignee_changed: "reassigned",
  assignee_added: "added an assignee",
  assignee_removed: "removed an assignee",
  milestone_changed: "changed milestone",
  tag_added: "added a tag",
  tag_removed: "removed a tag",
  comment_added: "commented",
  comment_edited: "edited a comment",
  comment_deleted: "deleted a comment",
  github_unlinked: "unlinked GitHub issue",
  github_labels_updated: "updated GitHub labels",
}

function describeEvent(e: AdminOverviewDTO["recentEvents"][number]): string {
  const label = EVENT_LABEL[e.kind] ?? e.kind
  return `${label} on "${e.reportTitle}" in ${e.projectName}`
}
</script>

<template>
  <div class="space-y-8">
    <!-- Page header -->
    <header class="flex items-end justify-between gap-4">
      <div>
        <div class="text-sm font-medium uppercase tracking-[0.18em] text-muted">Admin</div>
        <h1 class="mt-1 text-3xl font-semibold text-default tracking-tight">Overview</h1>
        <p class="mt-1.5 text-sm text-muted">
          Snapshot of incoming reports, health, and recent team activity across all projects.
        </p>
      </div>
      <UButton
        to="/"
        label="View all projects"
        trailing-icon="i-heroicons-arrow-right"
        color="primary"
        size="md"
      />
    </header>

    <!-- Metric tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="relative overflow-hidden rounded-xl border border-default bg-default p-5">
        <div
          class="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15"
        >
          <UIcon name="i-heroicons-inbox" class="size-4" />
        </div>
        <div class="mt-4 text-sm font-medium uppercase tracking-wider text-muted">Open reports</div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.open ?? 0 }}
        </div>
      </div>

      <div class="relative overflow-hidden rounded-xl border border-default bg-default p-5">
        <div class="flex items-center justify-center size-8 rounded-lg bg-muted text-muted">
          <UIcon name="i-heroicons-sparkles" class="size-4" />
        </div>
        <div class="mt-4 text-sm font-medium uppercase tracking-wider text-muted">
          New · last 7 days
        </div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.newThisWeek ?? 0 }}
        </div>
      </div>

      <div class="relative overflow-hidden rounded-xl border border-default bg-default p-5">
        <div class="flex items-center justify-center size-8 rounded-lg bg-muted text-muted">
          <UIcon name="i-heroicons-chart-bar" class="size-4" />
        </div>
        <div class="mt-4 text-sm font-medium uppercase tracking-wider text-muted">
          Total reports
        </div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.total ?? 0 }}
        </div>
      </div>

      <NuxtLink
        to="/"
        class="group relative overflow-hidden rounded-xl border border-default bg-default p-5 transition hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.14)]"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center justify-center size-8 rounded-lg bg-muted text-muted">
            <UIcon name="i-heroicons-squares-2x2" class="size-4" />
          </div>
          <UIcon
            name="i-heroicons-arrow-up-right"
            class="size-3.5 text-muted opacity-0 group-hover:opacity-100 transition"
          />
        </div>
        <div class="mt-4 text-sm font-medium uppercase tracking-wider text-muted">Projects</div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.projects ?? 0 }}
        </div>
        <div class="mt-1 text-sm text-muted">
          {{ metrics?.projectsWithGithub ?? 0 }} connected to GitHub
        </div>
      </NuxtLink>
    </div>

    <!-- Insights -->
    <div v-if="projectCount > 0" class="space-y-4">
      <div class="rounded-xl border border-default bg-default">
        <div class="px-5 py-4 border-b border-default">
          <h2 class="text-sm font-semibold text-default tracking-tight">Reports over time</h2>
          <p class="mt-0.5 text-sm text-muted">Reports received per day, last 30 days.</p>
        </div>
        <div class="p-5">
          <AreaChart
            v-if="hasVolume"
            :data="volume"
            :height="240"
            :categories="volumeCategories"
            :x-formatter="volumeXFormatter"
            :x-num-ticks="6"
          />
          <div v-else class="text-sm text-muted py-10 text-center">No reports yet.</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="rounded-xl border border-default bg-default">
          <div class="px-5 py-4 border-b border-default">
            <h2 class="text-sm font-semibold text-default tracking-tight">Status distribution</h2>
          </div>
          <div class="p-5 flex justify-center donut-segments">
            <DonutChart
              v-if="hasStatus"
              :data="statusData"
              :height="240"
              :categories="statusCategories"
              :radius="4"
              :arc-width="24"
            />
            <div v-else class="text-sm text-muted py-10 text-center">No reports yet.</div>
          </div>
        </div>

        <div class="rounded-xl border border-default bg-default">
          <div class="px-5 py-4 border-b border-default">
            <h2 class="text-sm font-semibold text-default tracking-tight">
              Top projects by open reports
            </h2>
          </div>
          <div class="p-5">
            <BarChart
              v-if="hasTopProjects"
              :data="topProjects"
              :height="240"
              :categories="topProjectsCategories"
              :y-axis="['open']"
              :orientation="Orientation.Horizontal"
              :y-formatter="topProjectsYFormatter"
            />
            <div v-else class="text-sm text-muted py-10 text-center">No open reports yet.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Two-column: recent reports + activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="rounded-xl border border-default bg-default">
        <div class="flex items-center justify-between px-5 py-4 border-b border-default">
          <h2 class="text-sm font-semibold text-default tracking-tight">Recent reports</h2>
        </div>
        <div
          v-if="!recentReports || recentReports.length === 0"
          class="text-sm text-muted py-10 text-center"
        >
          No reports yet.
        </div>
        <ul v-else class="divide-y divide-default">
          <li v-for="r in recentReports" :key="r.id">
            <NuxtLink
              :to="`/projects/${r.projectId}/reports/${r.id}`"
              class="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-elevated/50"
            >
              <span
                class="shrink-0 text-sm font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-elevated text-muted"
              >
                {{ r.projectName }}
              </span>
              <UBadge
                :label="r.priority"
                :color="priorityColor(r.priority)"
                variant="soft"
                size="sm"
                class="capitalize shrink-0"
              />
              <span class="flex-1 min-w-0 truncate text-default">{{ r.title }}</span>
              <span class="text-sm text-muted whitespace-nowrap tabular-nums">
                {{ relativeTime(r.receivedAt) }}
              </span>
            </NuxtLink>
          </li>
        </ul>
      </div>

      <div class="rounded-xl border border-default bg-default">
        <div class="px-5 py-4 border-b border-default">
          <h2 class="text-sm font-semibold text-default tracking-tight">Activity</h2>
        </div>
        <div
          v-if="!recentActivity || recentActivity.length === 0"
          class="text-sm text-muted py-10 text-center"
        >
          No activity yet.
        </div>
        <ul v-else class="px-5 py-4 space-y-3.5">
          <li v-for="e in recentActivity" :key="e.id" class="flex items-start gap-3 text-sm">
            <span
              class="shrink-0 mt-1.5 inline-block size-1.5 rounded-full bg-primary/60"
              aria-hidden="true"
            />
            <div class="flex-1 min-w-0">
              <span class="text-default font-medium">
                {{ e.actor?.name ?? e.actor?.email ?? "System" }}
              </span>
              <span>&nbsp;</span>
              <span class="text-muted">{{ describeEvent(e) }}</span>
              <div class="mt-0.5 text-sm text-muted tabular-nums">
                {{ relativeTime(e.createdAt) }}
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Per-project breakdown -->
    <div v-if="perProject.length > 0" class="rounded-xl border border-default bg-default">
      <div class="px-5 py-4 border-b border-default">
        <h2 class="text-sm font-semibold text-default tracking-tight">Projects</h2>
      </div>
      <ul class="divide-y divide-default">
        <li v-for="p in perProject" :key="p.id">
          <NuxtLink
            :to="`/projects/${p.id}`"
            class="flex items-center gap-4 px-5 py-3 text-sm transition-colors hover:bg-elevated/50"
          >
            <span class="flex-1 min-w-0 truncate font-medium text-default">{{ p.name }}</span>
            <span class="text-sm text-muted tabular-nums shrink-0">
              <span class="font-semibold text-default">{{ p.openCount }}</span> open
            </span>
            <span class="text-sm text-muted tabular-nums shrink-0">
              {{ p.newLast7Count }} new · 7d
            </span>
            <span class="text-sm text-muted tabular-nums shrink-0"> {{ p.totalCount }} total </span>
            <UIcon name="i-heroicons-chevron-right" class="size-4 text-muted shrink-0" />
          </NuxtLink>
        </li>
      </ul>
    </div>

    <!-- Empty state when the install has no projects at all -->
    <AppEmptyState
      v-if="projectCount === 0"
      variant="gradient"
      icon="i-heroicons-squares-plus"
      title="Create your first project"
      description="Once you spin up a project, it'll appear here with open-report counts and recent activity."
      action-label="New project"
      action-to="/"
    />
  </div>
</template>

<style scoped>
/* Unovis draws a fixed light stroke between donut segments that doesn't
   follow the theme, so on the dark dashboard it shows as white slivers.
   Repaint it with the card background token (theme-safe in light + dark).
   Scoped to the donut card only so the area/bar chart paths are untouched. */
.donut-segments :deep(svg path) {
  stroke: var(--ui-bg);
  stroke-width: 1.5px;
}
</style>
