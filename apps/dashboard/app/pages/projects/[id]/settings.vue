<script setup lang="ts">
import { ref, computed } from "vue"
import type { ProjectDTO } from "@reprojs/shared"
import ConfirmDeleteDialog from "~/components/common/confirm-delete-dialog.vue"

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
// Dashboard origin for the embed-snippet display. `useRequestURL()` resolves
// at request time: SSR reads the external Host header (via the reverse
// proxy), client reads `window.location.origin` — so the snippet shown to
// operators always matches the URL they're actually viewing.
const dashboardUrl = useRequestURL().origin
const projectId = computed(() => String(route.params.id))

const { data: project, refresh } = await useApi<ProjectDTO>(`/api/projects/${projectId.value}`)

useHead({
  title: () => (project.value?.name ? `${project.value.name} · Settings` : "Project settings"),
})

const isOwner = computed(() => project.value?.effectiveRole === "owner")

// Local form state — seeded from the fetched project.
const generalForm = ref({
  name: project.value?.name ?? "",
  originsText: (project.value?.allowedOrigins ?? []).join("\n"),
  dailyReportCap: project.value?.dailyReportCap ?? 1000,
})

const saving = ref(false)
const rotating = ref(false)
const replayUpdating = ref(false)
const deleteOpen = ref(false)
const deleting = ref(false)

const activeTab = ref("general")
const tabs = [
  { value: "general", label: "General", icon: "i-heroicons-cog-6-tooth" },
  { value: "triage", label: "Triage", icon: "i-heroicons-inbox" },
  { value: "security", label: "Security", icon: "i-heroicons-key" },
  { value: "danger", label: "Danger zone", icon: "i-heroicons-exclamation-triangle" },
]

function describeError(err: unknown): string | undefined {
  if (err instanceof Error) return err.message
  const e = err as { statusMessage?: string; data?: { statusMessage?: string } } | null
  return e?.data?.statusMessage ?? e?.statusMessage
}

async function saveGeneral() {
  saving.value = true
  const allowedOrigins = generalForm.value.originsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  try {
    await $fetch(`/api/projects/${projectId.value}`, {
      method: "PATCH",
      credentials: "include",
      body: {
        name: generalForm.value.name,
        allowedOrigins,
        dailyReportCap: generalForm.value.dailyReportCap,
      },
    })
    toast.add({ title: "Saved", color: "success", icon: "i-heroicons-check-circle" })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not save",
      description: describeError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    saving.value = false
  }
}

async function updateReplayEnabled(enabled: boolean) {
  replayUpdating.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}`, {
      method: "PATCH",
      credentials: "include",
      body: { replayEnabled: enabled },
    })
    toast.add({ title: "Saved", color: "success", icon: "i-heroicons-check-circle" })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not save",
      description: describeError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    replayUpdating.value = false
  }
}

async function rotateKey() {
  const ok = await confirm({
    title: "Rotate project key?",
    description:
      "Rotating invalidates the current key immediately. Embeds using the old key will stop working.",
    confirmLabel: "Rotate key",
    confirmColor: "warning",
    icon: "i-heroicons-key",
  })
  if (!ok) return
  rotating.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}/rotate-key`, {
      method: "POST",
      credentials: "include",
    })
    toast.add({ title: "Key rotated", color: "success", icon: "i-heroicons-check-circle" })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not rotate key",
      description: describeError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    rotating.value = false
  }
}

async function copyKey() {
  const key = project.value?.publicKey
  if (!key) return
  try {
    await navigator.clipboard.writeText(key)
    toast.add({ title: "Copied", color: "success", icon: "i-heroicons-clipboard-document-check" })
  } catch {
    toast.add({
      title: "Could not copy",
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function confirmDelete() {
  deleting.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}`, {
      method: "DELETE",
      credentials: "include",
    })
    toast.add({ title: "Project deleted", color: "success", icon: "i-heroicons-check-circle" })
    // The projects list (`/`) caches `/api/projects` under this key. Without
    // clearing it, client-side nav back to `/` shows the deleted project
    // until a hard refresh.
    clearNuxtData("projects-list")
    router.push("/")
  } catch (err) {
    toast.add({
      title: "Could not delete",
      description: describeError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    deleting.value = false
    deleteOpen.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-2xl font-semibold text-default">
        {{ project?.name ? `${project.name} — Settings` : "Settings" }}
      </h1>
      <p class="text-sm text-muted mt-1">Configure the project's intake, triage, and security.</p>
    </header>

    <UTabs v-model="activeTab" :items="tabs" value-key="value" :content="false" class="w-full" />

    <!-- General -->
    <div v-if="activeTab === 'general'" class="space-y-4 max-w-3xl">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-default">Project</h2>
        </template>
        <div class="space-y-4">
          <UFormField label="Name">
            <UInput v-model="generalForm.name" :disabled="!isOwner" class="w-full" />
          </UFormField>
          <UFormField
            label="Allowed origins"
            help="One origin per line (e.g. https://app.example.com). The SDK can only submit reports from an origin on this list. Leave empty to block all incoming reports — in production, an empty list means the project is inactive."
          >
            <UTextarea
              v-model="generalForm.originsText"
              :disabled="!isOwner"
              :rows="4"
              placeholder="https://app.example.com&#10;https://staging.example.com"
              class="w-full font-mono text-sm"
            />
          </UFormField>
          <UFormField
            label="Daily report cap"
            help="Rejects new reports once this daily limit is reached. Protects against runaway spam."
          >
            <UInput
              v-model.number="generalForm.dailyReportCap"
              :disabled="!isOwner"
              type="number"
              min="1"
              max="1000000"
              class="w-full"
            />
          </UFormField>
          <div class="flex justify-end">
            <UButton
              label="Save changes"
              color="primary"
              :loading="saving"
              :disabled="!isOwner"
              @click="saveGeneral"
            />
          </div>
        </div>
      </UCard>
    </div>

    <!-- Triage -->
    <div v-else-if="activeTab === 'triage'" class="space-y-4 max-w-3xl">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-default">Session replay</h2>
        </template>
        <div class="space-y-4">
          <UFormField
            label="Enable session replay"
            help="Capture the last 30s of DOM activity with each report. When off, the intake API silently drops incoming replay payloads."
          >
            <USwitch
              :model-value="project?.replayEnabled ?? false"
              :disabled="replayUpdating || !isOwner || !project"
              @update:model-value="updateReplayEnabled"
            />
          </UFormField>
        </div>
      </UCard>
    </div>

    <!-- Security -->
    <div v-else-if="activeTab === 'security'" class="space-y-4 max-w-3xl">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-default">Public SDK key</h2>
        </template>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            Embed this key in your SDK initialization. Rotate it if it leaks — embeds using the old
            key will stop working immediately.
          </p>
          <div class="flex gap-2">
            <UInput
              :model-value="project?.publicKey ?? '(not generated)'"
              readonly
              class="flex-1 font-mono"
            />
            <UButton
              label="Copy"
              icon="i-heroicons-clipboard"
              color="neutral"
              variant="outline"
              :disabled="!project?.publicKey"
              @click="copyKey"
            />
          </div>
          <div class="flex justify-end pt-2">
            <UButton
              label="Rotate key"
              color="warning"
              variant="soft"
              :loading="rotating"
              :disabled="!isOwner"
              @click="rotateKey"
            />
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-default">Embed snippet</h2>
        </template>
        <pre
          class="text-sm bg-elevated rounded p-3 overflow-x-auto"
        ><code>&lt;script src=&quot;{{ dashboardUrl }}/sdk/repro.iife.js&quot;&gt;&lt;/script&gt;
&lt;script&gt;
  Repro.init({
    projectKey: &quot;{{ project?.publicKey ?? 'rp_pk_...' }}&quot;,
    endpoint: &quot;{{ dashboardUrl }}&quot;
  })
&lt;/script&gt;</code></pre>
      </UCard>
    </div>

    <!-- Danger zone -->
    <div v-else-if="activeTab === 'danger'" class="space-y-4 max-w-3xl">
      <UCard :ui="{ root: 'border-error/30' }">
        <template #header>
          <h2 class="text-base font-semibold text-error">Delete project</h2>
        </template>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            Permanently deletes the project, all reports, attachments, and integration settings.
            This cannot be undone.
          </p>
          <p v-if="!isOwner" class="text-sm text-muted">
            Only project owners can delete this project.
          </p>
          <div class="flex justify-end">
            <UButton
              label="Delete project"
              icon="i-heroicons-trash"
              color="error"
              :disabled="!isOwner"
              @click="deleteOpen = true"
            />
          </div>
        </div>
      </UCard>
    </div>

    <ConfirmDeleteDialog
      :open="deleteOpen"
      title="Delete project"
      :description="`This permanently deletes ${project?.name ?? 'this project'} and all its data. This cannot be undone.`"
      :confirm-text="project?.name ?? undefined"
      :loading="deleting"
      @update:open="deleteOpen = $event"
      @confirm="confirmDelete"
    />
  </div>
</template>
