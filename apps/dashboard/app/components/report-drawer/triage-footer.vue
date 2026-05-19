<!-- apps/dashboard/app/components/report-drawer/triage-footer.vue
     Triage panel for the report drawer sidebar. Three collapsible
     sections (Properties · Labels · GitHub) separated by whitespace,
     each with a single unified typographic scale — text-sm everywhere.

     Assignees + milestone are GitHub-mirrored — they only render when
     the project has a connected GitHub integration AND this report is
     already linked to an issue. Status/priority/tags/labels always
     render. -->
<script setup lang="ts">
import type {
  GithubConfigDTO,
  ReportDetailDTO,
  ReportPriority,
  ReportStatus,
  ReportSummaryDTO,
} from "@reprojs/shared"
import LabelsPicker from "./pickers/labels-picker.vue"
import AssigneesPicker from "./pickers/assignees-picker.vue"
import MilestonePicker from "./pickers/milestone-picker.vue"
import UnlinkDialog from "~/components/integrations/github/unlink-dialog.vue"
import { safeHref } from "~/composables/use-safe-href"
import { pollUntil } from "~/composables/use-poll-until"
import { useGithubIntegration } from "~/composables/use-github-integration"

interface Props {
  projectId: string
  report: ReportSummaryDTO
  canEdit: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ patched: [] }>()

const toast = useToast()

const STATUSES: ReportStatus[] = ["open", "in_progress", "resolved", "closed"]
const PRIORITIES: ReportPriority[] = ["urgent", "high", "normal", "low"]

const { data: githubConfig } = useApi<GithubConfigDTO>(
  `/api/projects/${props.projectId}/integrations/github`,
)
const githubReady = computed(
  () => Boolean(githubConfig.value?.installed) && githubConfig.value?.status === "connected",
)

const projectIdRef = toRef(() => props.projectId)
const { state: integrationState } = useGithubIntegration(projectIdRef)
const isProjectLinked = computed(() => integrationState.value.isLinked)
const isReportLinked = computed(
  () => isProjectLinked.value && props.report.githubIssueNumber !== null,
)

const tagDraft = ref("")
const posting = ref(false)
const unlinkOpen = ref(false)
const ghSubmitting = ref(false)

async function createIssue() {
  ghSubmitting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}/github-sync`, {
      method: "POST",
      credentials: "include",
    })
    // github-sync is async: it enqueues an in-process worker and returns
    // immediately. Poll the report until the worker links the issue, then
    // refetch once so the parent renders consistent data. ~12s ceiling.
    const linked = await pollUntil(
      () =>
        $fetch<ReportDetailDTO>(`/api/projects/${props.projectId}/reports/${props.report.id}`, {
          credentials: "include",
        }),
      (r) => r.githubIssueNumber !== null,
      { attempts: 12, intervalMs: 1000 },
    )
    emit("patched")
    if (linked) {
      toast.add({
        title: "GitHub issue created",
        color: "success",
        icon: "i-heroicons-check-circle",
      })
    } else {
      toast.add({
        title: "Issue is being created",
        description: "It'll appear here shortly.",
        color: "info",
        icon: "i-heroicons-information-circle",
      })
    }
  } catch (err) {
    toast.add({
      title: "Could not create GitHub issue",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    ghSubmitting.value = false
  }
}

async function unlink() {
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}/github-unlink`, {
      method: "POST",
      credentials: "include",
    })
    unlinkOpen.value = false
    emit("patched")
    toast.add({ title: "Unlinked from GitHub", color: "success", icon: "i-heroicons-check-circle" })
  } catch (err) {
    toast.add({
      title: "Could not unlink",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

function ghRepoFullName(url: string | null): string {
  if (!url) return ""
  const match = /github\.com\/([^/]+\/[^/]+)\/issues\//.exec(url)
  return match?.[1] ?? ""
}

async function patch(body: Record<string, unknown>) {
  posting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}`, {
      method: "PATCH",
      body,
      credentials: "include",
    })
    emit("patched")
    toast.add({ title: "Saved", color: "success", icon: "i-heroicons-check-circle" })
  } catch (err) {
    toast.add({
      title: "Could not save",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    posting.value = false
  }
}

async function addTag() {
  const name = tagDraft.value.trim()
  if (!name || props.report.tags.includes(name)) {
    tagDraft.value = ""
    return
  }
  tagDraft.value = ""
  await patch({ tags: [...props.report.tags, name] })
}
async function removeTag(name: string) {
  await patch({ tags: props.report.tags.filter((t) => t !== name) })
}

const statusModel = computed<ReportStatus>({
  get: () => props.report.status,
  set: (v) => {
    if (v !== props.report.status) void patch({ status: v })
  },
})
const priorityModel = computed<ReportPriority>({
  get: () => props.report.priority,
  set: (v) => {
    if (v !== props.report.priority) void patch({ priority: v })
  },
})

function titleCase(s: string): string {
  return s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

const statusItems = computed(() => STATUSES.map((s) => ({ label: titleCase(s), value: s })))
const priorityItems = computed(() => PRIORITIES.map((p) => ({ label: titleCase(p), value: p })))

const assigneeLogins = computed(() => props.report.assignees.map((a) => a.login))

// Collapsed-state summaries — shown inline when the section is closed so
// the sidebar stays informative at a glance without forcing an expand.
const propertiesSummary = computed(() => {
  const parts: string[] = [titleCase(props.report.status), titleCase(props.report.priority)]
  if (isReportLinked.value) {
    const n = props.report.assignees.length
    if (n > 0) parts.push(`${n} Assignee${n === 1 ? "" : "s"}`)
    if (props.report.milestoneTitle) parts.push(props.report.milestoneTitle)
  }
  return parts.join(" · ")
})
const labelsSummary = computed(() => {
  const n = props.report.tags.length
  if (n === 0) return "None"
  return `${n} ${n === 1 ? "Label" : "Labels"}`
})
const githubSummary = computed(() => {
  if (props.report.githubIssueNumber && props.report.githubIssueUrl) {
    return `#${props.report.githubIssueNumber}`
  }
  return githubReady.value ? "Not Linked" : "Not Configured"
})

const open = reactive({ properties: true, labels: true, github: true })

// Priority dot colour — quiet signal in the collapsed header so severity
// stays legible without expanding Properties.
const priorityDotClass = computed<string>(() => {
  switch (props.report.priority) {
    case "urgent":
      return "bg-error"
    case "high":
      return "bg-warning"
    case "normal":
      return "bg-primary/70"
    case "low":
    default:
      return "bg-muted-foreground/50"
  }
})
</script>

<template>
  <div class="divide-y divide-default/60">
    <!-- Properties -->
    <section class="py-4 first:pt-0">
      <button
        type="button"
        class="flex w-full items-center gap-2 pb-3 text-sm font-semibold text-default hover:text-primary transition-colors"
        :aria-expanded="open.properties"
        @click="open.properties = !open.properties"
      >
        <UIcon name="i-lucide-sliders-horizontal" class="size-4 shrink-0 opacity-80" />
        <span>Properties</span>
        <span
          class="ml-auto inline-flex items-center gap-1.5 min-w-0 max-w-[60%] truncate text-sm font-normal text-dimmed"
        >
          <span
            class="inline-block size-1.5 rounded-full shrink-0"
            :class="priorityDotClass"
            aria-hidden="true"
          />
          <span class="truncate">{{ propertiesSummary }}</span>
        </span>
        <UIcon
          name="i-heroicons-chevron-down"
          class="size-4 shrink-0 opacity-60 transition-transform duration-200"
          :class="{ '-rotate-90': !open.properties }"
        />
      </button>
      <div v-show="open.properties" class="flex flex-col gap-2 pt-1">
        <div class="grid grid-cols-[5.5rem_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted">Status</span>
          <USelectMenu
            v-model="statusModel"
            :items="statusItems"
            value-key="value"
            size="md"
            class="w-full min-w-0"
            :disabled="!canEdit || posting"
          />
        </div>

        <div v-if="isReportLinked" class="flex flex-col gap-1.5">
          <span class="text-sm font-medium text-muted">Assignees</span>
          <AssigneesPicker
            :project-id="projectId"
            :model-value="assigneeLogins"
            :disabled="!canEdit || posting"
            @update:model-value="patch({ assignees: $event })"
          />
        </div>

        <div class="grid grid-cols-[5.5rem_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted">Priority</span>
          <USelectMenu
            v-model="priorityModel"
            :items="priorityItems"
            value-key="value"
            size="md"
            class="w-full min-w-0 capitalize"
            :disabled="!canEdit || posting"
          />
        </div>

        <div v-if="isReportLinked" class="grid grid-cols-[5.5rem_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted">Milestone</span>
          <MilestonePicker
            :project-id="projectId"
            :model-value="
              report.milestoneNumber !== null && report.milestoneTitle !== null
                ? {
                    number: report.milestoneNumber as number,
                    title: report.milestoneTitle as string,
                  }
                : null
            "
            :disabled="!canEdit || posting"
            class="w-full min-w-0"
            @update:model-value="patch({ milestone: $event })"
          />
        </div>
      </div>
    </section>

    <!-- Labels / Tags -->
    <section class="py-4">
      <button
        type="button"
        class="flex w-full items-center gap-2 pb-3 text-sm font-semibold text-default hover:text-primary transition-colors"
        :aria-expanded="open.labels"
        @click="open.labels = !open.labels"
      >
        <UIcon name="i-lucide-tag" class="size-4 shrink-0 opacity-80" />
        <span>Labels</span>
        <span class="ml-auto truncate text-sm font-normal text-dimmed">
          {{ labelsSummary }}
        </span>
        <UIcon
          name="i-heroicons-chevron-down"
          class="size-4 shrink-0 opacity-60 transition-transform duration-200"
          :class="{ '-rotate-90': !open.labels }"
        />
      </button>
      <div v-show="open.labels" class="pt-1">
        <template v-if="isProjectLinked">
          <LabelsPicker
            :project-id="projectId"
            :model-value="report.tags"
            :disabled="!canEdit || posting"
            @update:model-value="patch({ tags: $event })"
          />
        </template>
        <template v-else>
          <div class="flex flex-col gap-2">
            <UInput
              v-if="canEdit"
              v-model="tagDraft"
              placeholder="Add a label…"
              size="md"
              variant="outline"
              icon="i-heroicons-plus"
              class="w-full"
              @keydown.enter.prevent="addTag"
            />
            <div v-if="report.tags.length" class="flex flex-wrap gap-1.5">
              <span
                v-for="t in report.tags"
                :key="t"
                class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-sm font-semibold leading-snug tracking-tight ring-1 ring-inset ring-black/10 bg-primary/15 text-primary"
              >
                <span>{{ t }}</span>
                <button
                  v-if="canEdit"
                  type="button"
                  class="inline-flex items-center justify-center size-4 rounded-full text-current opacity-60 hover:opacity-100 hover:bg-black/10 transition-opacity cursor-pointer"
                  :aria-label="`Remove label ${t}`"
                  :title="`Remove ${t}`"
                  @click="removeTag(t)"
                >
                  <UIcon name="i-lucide-x" class="size-3 shrink-0" />
                </button>
              </span>
            </div>
            <span v-else-if="!canEdit" class="text-sm text-muted italic">None</span>
          </div>
        </template>
      </div>
    </section>

    <!-- GitHub -->
    <section class="py-4 last:pb-0">
      <button
        type="button"
        class="flex w-full items-center gap-2 pb-3 text-sm font-semibold text-default hover:text-primary transition-colors"
        :aria-expanded="open.github"
        @click="open.github = !open.github"
      >
        <UIcon name="i-simple-icons-github" class="size-4 shrink-0 opacity-80" />
        <span>GitHub</span>
        <span class="ml-auto truncate text-sm font-normal text-dimmed">
          {{ githubSummary }}
        </span>
        <UIcon
          name="i-heroicons-chevron-down"
          class="size-4 shrink-0 opacity-60 transition-transform duration-200"
          :class="{ '-rotate-90': !open.github }"
        />
      </button>
      <div v-show="open.github" class="flex flex-col gap-2 pt-1">
        <template v-if="report.githubIssueNumber && report.githubIssueUrl">
          <a
            :href="safeHref(report.githubIssueUrl)"
            target="_blank"
            rel="noopener"
            class="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-default bg-elevated/40 hover:bg-elevated/80 hover:border-primary/30 transition-colors text-default"
          >
            <UIcon name="i-simple-icons-github" class="size-4 shrink-0" />
            <span class="inline-flex items-baseline gap-1.5 flex-1 min-w-0">
              <span class="truncate text-sm text-muted">
                {{ ghRepoFullName(report.githubIssueUrl) }}
              </span>
              <span class="shrink-0 font-mono text-sm font-medium">
                #{{ report.githubIssueNumber }}
              </span>
            </span>
            <UIcon
              name="i-heroicons-arrow-top-right-on-square"
              class="size-4 shrink-0 text-muted group-hover:text-primary transition-colors"
            />
          </a>
          <button
            v-if="canEdit"
            type="button"
            class="inline-flex items-center gap-1.5 self-start px-2 py-1 rounded-md text-sm text-muted hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
            @click="unlinkOpen = true"
          >
            <UIcon name="i-heroicons-link-slash" class="size-4" />
            <span>Unlink issue</span>
          </button>
        </template>

        <UButton
          v-else-if="canEdit && githubReady"
          size="md"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
          :loading="ghSubmitting"
          :label="ghSubmitting ? 'Creating…' : 'Create GitHub issue'"
          block
          @click="createIssue"
        />

        <div
          v-else-if="canEdit"
          class="flex flex-col gap-2.5 p-3 rounded-lg border border-dashed border-default bg-elevated/40"
        >
          <div class="flex items-start gap-2">
            <UIcon
              name="i-heroicons-information-circle"
              class="size-4 text-muted shrink-0 mt-0.5"
            />
            <p class="text-sm text-muted leading-relaxed">
              Connect the GitHub App to this project to sync reports as issues.
            </p>
          </div>
          <UButton
            :to="`/projects/${projectId}/integrations`"
            size="md"
            color="neutral"
            variant="outline"
            icon="i-simple-icons-github"
            label="Set up GitHub integration"
            trailing-icon="i-heroicons-arrow-right"
            block
          />
        </div>
        <span v-else class="text-sm text-muted italic">Not linked</span>
      </div>
    </section>

    <UnlinkDialog
      v-if="report.githubIssueNumber && report.githubIssueUrl"
      :issue-number="report.githubIssueNumber"
      :repo-full-name="ghRepoFullName(report.githubIssueUrl)"
      :open="unlinkOpen"
      @cancel="unlinkOpen = false"
      @confirm="unlink"
    />
  </div>
</template>
