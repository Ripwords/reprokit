<script setup lang="ts">
import type { ProjectDTO } from "@reprojs/shared"
import AppEmptyState from "~/components/common/app-empty-state.vue"

useHead({ title: "Projects" })

const toast = useToast()
const route = useRoute()
const router = useRouter()

// If the project-exists middleware bounced us here, surface a toast once.
// Also clear the `last-project-id` cookie so the sidebar stops rendering
// project-scoped links to the dead UUID — otherwise clicking Overview (or
// any other item) would bounce the user right back here in a loop.
const lastProjectId = useCookie<string | null>("last-project-id")
onMounted(() => {
  if (route.query.error === "project-not-found") {
    toast.add({
      title: "Project not found",
      description: "The project you tried to open doesn't exist or you don't have access.",
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
    lastProjectId.value = null
    router.replace({ query: {} })
  }
})
const {
  data: projects,
  pending,
  refresh,
} = await useApi<ProjectDTO[]>("/api/projects", {
  key: "projects-list",
  default: () => [],
})

const list = computed(() => projects.value ?? [])

const newOpen = ref(false)
const newName = ref("")
const creating = ref(false)

// Any authenticated user can create a project — the server's POST /api/projects
// only calls requireSession (not requireInstallAdmin). The UI mirrors that.
const { session } = useSession()
const canCreate = computed(() => Boolean(session.value?.data?.user))

async function createProject() {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    await $fetch<ProjectDTO>("/api/projects", {
      method: "POST",
      credentials: "include",
      body: { name: newName.value.trim() },
    })
    toast.add({
      title: "Project created",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
    newOpen.value = false
    newName.value = ""
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not create project",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-8">
    <header class="flex items-start justify-between gap-6">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium uppercase tracking-[0.18em] text-muted">Workspace</div>
        <h1 class="mt-1 text-3xl font-semibold text-default tracking-tight">Projects</h1>
        <p class="mt-2 text-sm text-muted max-w-xl">
          Each project carries its own SDK key, member list, and inbox. Pick one to triage, or spin
          up a new one.
        </p>
      </div>
      <UButton
        v-if="canCreate"
        label="New project"
        icon="i-heroicons-plus"
        color="primary"
        size="md"
        class="mt-7 shrink-0"
        @click="newOpen = true"
      />
    </header>

    <AppEmptyState
      v-if="!pending && list.length === 0"
      variant="gradient"
      icon="i-heroicons-squares-plus"
      title="Create your first project"
      description="A project groups incoming reports from a single app or site. You'll get an SDK key once it's created."
      action-label="New project"
      @action="newOpen = true"
    />

    <!-- auto-fill grid — cards size consistently at ~18rem, but only take
         as many columns as they need. 1 project fills 1 column with a tight
         "New project" tile next to it, rather than leaving gaping holes in
         a fixed 3-column layout. -->
    <div
      v-else
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr))"
    >
      <NuxtLink
        v-for="(p, i) in list"
        :key="p.id"
        :to="`/projects/${p.id}`"
        class="group relative block overflow-hidden rounded-xl border border-default bg-default p-5 transition duration-300 hover:border-default/80 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] fade-up"
        :style="{ '--fade-up-delay': `${i * 40}ms` }"
      >
        <div class="relative flex items-start gap-3">
          <div
            class="flex items-center justify-center size-9 rounded-lg bg-elevated text-default ring-1 ring-default shrink-0"
          >
            <UIcon name="i-heroicons-folder" class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold text-default tracking-tight truncate">
              {{ p.name }}
            </h3>
            <div
              class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider text-muted"
            >
              <span
                class="inline-block size-1.5 rounded-full"
                :class="p.effectiveRole === 'owner' ? 'bg-warning' : 'bg-muted/70'"
              />
              {{ p.effectiveRole }}
            </div>
          </div>
          <UIcon
            name="i-heroicons-arrow-up-right"
            class="size-4 text-muted opacity-0 -translate-x-1 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-default"
          />
        </div>
      </NuxtLink>
      <button
        v-if="canCreate"
        type="button"
        class="rounded-xl border border-dashed border-default/80 p-5 flex flex-col items-center justify-center text-muted hover:border-default hover:text-default hover:bg-elevated/40 transition-colors fade-up"
        :style="{ '--fade-up-delay': `${list.length * 40}ms` }"
        @click="newOpen = true"
      >
        <UIcon name="i-heroicons-plus" class="size-7" />
        <span class="mt-2 text-sm font-medium">New project</span>
      </button>
    </div>

    <UModal v-model:open="newOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <form class="p-6 space-y-5" @submit.prevent="createProject">
          <div class="flex items-start gap-3">
            <div
              class="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 shrink-0"
            >
              <UIcon name="i-heroicons-squares-plus" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-semibold text-default tracking-tight">Create project</h3>
              <p class="mt-1 text-sm text-muted">Pick a name. You can rename it any time.</p>
            </div>
          </div>
          <UFormField label="Name" required>
            <UInput v-model="newName" placeholder="My App" autofocus class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-1">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="newOpen = false" />
            <UButton type="submit" label="Create project" color="primary" :loading="creating" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
