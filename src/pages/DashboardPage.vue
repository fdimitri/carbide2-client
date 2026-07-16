<template>
  <div id="dash-root" class="min-h-full bg-bg-0 text-text font-ui">
    <!-- Hero strip -->
    <div id="dash-hero" class="relative border-b border-line/70 bg-gradient-to-b from-bg-1/50 to-transparent px-8 py-6">
      <div class="max-w-5xl mx-auto flex items-end justify-between gap-6 flex-wrap">
        <div class="min-w-0">
          <p class="flex items-center gap-2 text-muted text-ui-xs font-mono uppercase tracking-widest mb-1.5">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(90,176,255,0.85)]"></span>
            {{ scopeLabel }}
          </p>
          <h1 class="text-text text-ui-3xl font-bold tracking-tight leading-none">{{ pluralTitle }}</h1>
        </div>
        <div class="flex items-center gap-2">
          <a href="/about" target="_blank" class="btn-ghost no-underline">About</a>
          <button class="btn-primary" @click="showNewForm = !showNewForm">
            <span class="text-base leading-none font-bold">+</span> New {{ singularTitle }}
          </button>
        </div>
      </div>
    </div>

    <div id="dash-list" class="max-w-5xl mx-auto px-8 py-8">

      <!-- New item inline form -->
      <div v-if="showNewForm"
        class="mb-8 p-5 rounded-xl border border-accent/25 bg-bg-1/70 backdrop-blur flex flex-wrap gap-4 items-end">
        <UiField class="flex-1 min-w-44" label="Name" label-class="text-muted text-label font-semibold uppercase tracking-widest">
          <UiInput v-model="newName" :placeholder="`my-${singularSlug}`" autofocus />
        </UiField>
        <UiField class="flex-1 min-w-44" label="Description" label-class="text-muted text-label font-semibold uppercase tracking-widest">
          <UiInput v-model="newDesc" placeholder="optional" />
        </UiField>

        <!-- Seed method: how the new workspace's project starts out. "Empty"
             is always valid; "Clone from git" stashes a pending seed that the
             pod's IDE runs on first open (in-pod import_from_git). -->
        <div class="flex flex-col gap-1.5 w-full">
          <label class="text-muted text-label font-semibold uppercase tracking-widest">Start from</label>
          <div class="flex gap-2">
            <button type="button" @click="seedMethod = 'empty'"
              :class="seedMethod === 'empty' ? 'border-accent text-text bg-bg-2/85' : 'border-line text-muted'"
              class="px-3 py-2 rounded-lg bg-transparent border text-sm cursor-pointer hover:border-accent transition-all">
              Empty project
            </button>
            <button type="button" @click="seedMethod = 'git'"
              :class="seedMethod === 'git' ? 'border-accent text-text bg-bg-2/85' : 'border-line text-muted'"
              class="px-3 py-2 rounded-lg bg-transparent border text-sm cursor-pointer hover:border-accent transition-all">
              Clone from git
            </button>
          </div>
        </div>

        <!-- Git seed inputs, only when "Clone from git" is selected. -->
        <div v-if="seedMethod === 'git'" class="flex flex-wrap gap-4 w-full">
          <UiField class="flex-1 min-w-56" label="Repository URL" label-class="text-muted text-label font-semibold uppercase tracking-widest">
            <UiInput v-model="seedGitUrl" placeholder="https://github.com/user/repo.git" />
          </UiField>
          <UiField class="min-w-40" label="Branch / ref" label-class="text-muted text-label font-semibold uppercase tracking-widest">
            <UiInput v-model="seedGitRef" placeholder="default branch" />
          </UiField>
        </div>

        <div class="flex gap-2">
          <UiButton variant="primary" @click="createItem" :disabled="!canCreate">Create</UiButton>
          <UiButton @click="showNewForm = false">Cancel</UiButton>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-20 gap-3 text-muted text-sm">
        <span class="animate-spin text-accent">◈</span> Loading {{ pluralLower }}…
      </div>

      <!-- Empty -->
      <div v-else-if="items.length === 0" class="text-center py-24">
        <div class="text-5xl mb-4 text-bg-3">◈</div>
        <p class="text-text font-semibold mb-1">No {{ pluralLower }} yet</p>
        <p class="text-muted text-sm">Create one to get started.</p>
      </div>

      <!-- Item grid -->
      <div v-else class="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
        <div v-for="p in items" :key="p.id"
          class="group relative rounded-xl border border-line bg-bg-1/60 p-7 cursor-pointer overflow-hidden
                 hover:border-accent/50 hover:bg-bg-2/85
                 hover:shadow-[0_8px_32px_rgba(90,176,255,0.1)]
                 transition-all duration-200"
          @click="openItem(p.id)">
          <div class="absolute inset-x-0 top-0 h-0.5 bg-accent origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-200"></div>
          <div class="flex items-start justify-between gap-2 mb-1">
            <h3 class="text-text font-semibold">{{ p.name }}</h3>
            <span class="shrink-0 flex items-center gap-1.5 mt-0.5" :title="healthTitle(p.id)">
              <span class="inline-block w-2 h-2 rounded-full" :class="healthDotClass(p.id)"></span>
            </span>
          </div>
          <p class="text-muted text-xs mb-4 line-clamp-2 leading-relaxed">{{ p.description || 'No description' }}</p>
          <span class="text-ui-2xs text-dim font-mono">{{ formatDate(p.created_at) }}</span>
        </div>
      </div>

      <p v-if="error" class="mt-6 text-warn text-sm">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { listWorkspaces, createWorkspace, getWorkspaceHealth } from '../services/workspaceService'
import { setPendingSeed } from '../services/pendingSeed'
import UiButton from '../components/ui/UiButton.vue'
import UiInput from '../components/ui/UiInput.vue'
import UiField from '../components/ui/UiField.vue'

// Model B: this Dashboard is the CONTROL-PLANE dashboard. It lists the
// user's Workspaces (one isolated pod each). Workspace pods themselves have
// no dashboard — opening a Workspace lands directly in its IDE (handled by
// the router guard in workspace mode).
const router  = useRouter()
const items   = ref([])
const loading = ref(true)
const error   = ref('')

// Per-workspace reachability, keyed by id: { phase, reachable:{rails,ws}, ok }.
// `undefined` = not yet probed (shown as a neutral/pending dot).
const health = reactive({})
const HEALTH_POLL_MS = 8000
let healthTimer = null

const showNewForm = ref(false)
const newName = ref('')
const newDesc = ref('')

// Seed method chosen at create time. 'empty' is always valid; 'git' defers an
// in-pod clone to the workspace's first open (see services/pendingSeed.js).
const seedMethod = ref('empty')
const seedGitUrl = ref('')
const seedGitRef = ref('')

const canCreate = computed(() =>
  newName.value.trim() && (seedMethod.value !== 'git' || seedGitUrl.value.trim())
)

const singularTitle = 'Workspace'
const pluralTitle   = 'Your Workspaces'
const pluralLower   = 'workspaces'
const singularSlug  = 'workspace'
const scopeLabel    = 'Control Plane'

onMounted(async () => {
  await load()
  pollHealth()
  healthTimer = setInterval(pollHealth, HEALTH_POLL_MS)
})

onBeforeUnmount(() => {
  if (healthTimer) clearInterval(healthTimer)
})

async function load() {
  loading.value = true
  error.value   = ''
  try {
    items.value = await listWorkspaces()
  } catch (e) {
    error.value = e.message || 'Failed to load workspaces'
  } finally {
    loading.value = false
  }
}

// Probe every workspace in parallel. A failed probe leaves the last known
// state in place rather than flickering the dot to "down".
async function pollHealth() {
  await Promise.all(
    items.value.map(async (p) => {
      try {
        health[p.id] = await getWorkspaceHealth(p.id)
      } catch {
        /* keep previous state; transient API hiccup */
      }
    })
  )
}

function healthDotClass(id) {
  const h = health[id]
  if (!h) return 'bg-bg-3 animate-pulse'            // not yet probed
  if (h.ok) return 'bg-emerald-400'                 // rails + worker reachable
  if (h.reachable?.rails || h.reachable?.ws) return 'bg-amber-400' // partial
  return 'bg-rose-500'                              // unreachable
}

function healthTitle(id) {
  const h = health[id]
  if (!h) return 'Checking…'
  if (h.ok) return 'Running — Rails and worker reachable'
  const parts = []
  parts.push(h.reachable?.rails ? 'Rails up' : 'Rails unreachable')
  parts.push(h.reachable?.ws ? 'worker up' : 'worker unreachable')
  return `${h.phase || 'unknown'} — ${parts.join(', ')}`
}

async function createItem() {
  try {
    const ws = await createWorkspace(newName.value.trim(), newDesc.value.trim())
    // Stash the seed so the new pod's IDE performs it on first open. Keyed by
    // the pod's base path (/w/<id>/), which survives the cross-path redirect.
    if (seedMethod.value === 'git' && seedGitUrl.value.trim() && ws?.id != null) {
      setPendingSeed(`/w/${ws.id}/`, {
        method: 'git',
        gitUrl: seedGitUrl.value.trim(),
        gitRef: seedGitRef.value.trim(),
      })
    }
    newName.value = ''
    newDesc.value = ''
    seedMethod.value = 'empty'
    seedGitUrl.value = ''
    seedGitRef.value = ''
    showNewForm.value = false
    await load()
    pollHealth()
  } catch (e) {
    error.value = e.message || 'Failed to create workspace'
  }
}

function openItem(id) {
  // Redirect cross-path to the workspace ingress; Traefik forwards /w/<id>/
  // to the workspace pod, which serves the SPA in workspace mode and lands
  // directly in the IDE.
  window.location.href = `/w/${id}/`
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString()
}
</script>
