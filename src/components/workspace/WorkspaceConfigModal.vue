<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Dialog from 'primevue/dialog'
import UiButton from '../ui/UiButton.vue'
import {
  listTemplates, listRegistryImages, patchWorkspace, rollWorkspace, getWorkspace,
  getShellStatus, setShellMode
} from '../../services/workspaceService'

const props = defineProps({
  visible: Boolean,
  workspace: Object
})
const emit = defineEmits(['update:visible', 'close', 'changed'])

const templates = ref([])
const registry = ref(null)          // { images: [...] } or null when no registry
const registryError = ref(false)    // true -> no registry configured (503)
const error = ref('')
const busy = ref(false)

const selectedTemplate = ref('')
const selectedImageTag = ref('')

// ADR-029 shell lifecycle. Phase is derived server-side from the live pod on
// every call, so this is polled rather than read once: a shell can idle down,
// cold start, or fail an image pull entirely between opening the dialog and
// looking at it.
const shell = ref(null)
const shellBusy = ref(false)
let shellPoll = null

const SHELL_MODES = [
  { value: 'eager',    label: 'Eager — always running' },
  { value: 'lazy',     label: 'Lazy — start on demand, stop when idle' },
  { value: 'disabled', label: 'Disabled — no shell' },
]

// Reason is only ever populated for a Failed phase, and it is a kubelet reason
// (ImagePullBackOff, CrashLoopBackOff, ...) rather than prose. Showing it raw
// is the point: it is the string you would search for.
const shellPhaseClass = computed(() => {
  switch (shell.value?.phase) {
    case 'Running':  return 'text-success'
    case 'Failed':   return 'text-warn'
    case 'Starting': return 'text-amber'
    default:         return 'text-muted'
  }
})

const current = ref(null)

const workspaceImages = computed(() =>
  (registry.value?.images || []).find((i) => i.repository === 'carbide2')?.tags || []
)

watch(() => props.visible, (v) => {
  if (v) {
    load()
    refreshShell()
    shellPoll = setInterval(refreshShell, 5000)
  } else if (shellPoll) {
    // Stop polling a dialog nobody is looking at — each call reads a pod from
    // the API server.
    clearInterval(shellPoll)
    shellPoll = null
  }
}, { immediate: true })

onBeforeUnmount(() => { if (shellPoll) clearInterval(shellPoll) })

async function refreshShell() {
  try {
    shell.value = await getShellStatus(props.workspace.id)
  } catch {
    shell.value = null
  }
}

async function applyShellMode(mode) {
  if (!mode || mode === shell.value?.mode) return
  shellBusy.value = true
  error.value = ''
  try {
    await setShellMode(props.workspace.id, mode)
    await refreshShell()
    emit('changed')
  } catch (e) {
    error.value = e.response?.data?.error || e.message || 'Failed to change shell mode'
  } finally {
    shellBusy.value = false
  }
}

async function load() {
  error.value = ''
  busy.value = false
  selectedTemplate.value = ''
  selectedImageTag.value = ''

  try {
    const [t, ws] = await Promise.all([listTemplates(), getWorkspace(props.workspace.id)])
    templates.value = t
    current.value = ws
  } catch (e) {
    error.value = e.message || 'Failed to load workspace config'
  }

  try {
    registry.value = await listRegistryImages()
    registryError.value = false
  } catch {
    registry.value = null
    registryError.value = true
  }
}

async function applyTemplate() {
  if (!selectedTemplate.value) return
  busy.value = true
  error.value = ''
  try {
    await patchWorkspace(props.workspace.id, { template_name: selectedTemplate.value })
    await refreshCurrent()
    emit('changed')
  } catch (e) {
    error.value = e.response?.data?.error || e.message || 'Failed to apply template'
  } finally {
    busy.value = false
  }
}

async function applyImageTag() {
  if (!selectedImageTag.value) return
  busy.value = true
  error.value = ''
  try {
    await patchWorkspace(props.workspace.id, { workspaceImageTag: selectedImageTag.value })
    await refreshCurrent()
    emit('changed')
  } catch (e) {
    error.value = e.response?.data?.error || e.message || 'Failed to apply image tag'
  } finally {
    busy.value = false
  }
}

async function roll() {
  if (!window.confirm('Restart this workspace? Live terminals and shell sessions will be dropped.')) return
  busy.value = true
  error.value = ''
  try {
    await rollWorkspace(props.workspace.id)
  } catch (e) {
    error.value = e.response?.data?.error || e.message || 'Failed to restart workspace'
  } finally {
    busy.value = false
  }
}

async function refreshCurrent() {
  try { current.value = await getWorkspace(props.workspace.id) } catch { /* keep last */ }
}

function close() {
  emit('update:visible', false)
  emit('close')
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="`Configure ${workspace?.name || 'workspace'}`"
    :style="{ width: '36rem' }"
    @update:visible="$emit('update:visible', $event)"
    @hide="close"
  >
    <div class="flex flex-col gap-5">
      <!-- Current state -->
      <section v-if="current" class="rounded-xl border border-line bg-bg-1/60 p-4 text-sm space-y-1">
        <h3 class="text-muted text-xs font-semibold uppercase tracking-widest mb-2">Current</h3>
        <div class="flex justify-between"><span class="text-muted">status</span><span class="font-mono">{{ current.status }}</span></div>
        <div class="flex justify-between"><span class="text-muted">template</span><span class="font-mono">{{ current.template_name || 'custom' }}</span></div>
        <div v-if="current.spec_drift" class="flex justify-between">
          <span class="text-warn">drift</span>
          <span class="font-mono text-warn">
            {{ current.resources_drift ? 'resources ' : '' }}{{ current.image_tag_drift ? 'image tag' : '' }}
          </span>
        </div>
        <div v-if="current.resources" class="flex justify-between">
          <span class="text-muted">limits</span>
          <span class="font-mono">{{ current.resources.limits?.cpu || '—' }} / {{ current.resources.limits?.memory || '—' }}</span>
        </div>
        <div v-if="current.resources" class="flex justify-between">
          <span class="text-muted">requests</span>
          <span class="font-mono">{{ current.resources.requests?.cpu || '—' }} / {{ current.resources.requests?.memory || '—' }}</span>
        </div>
        <div class="flex justify-between"><span class="text-muted">uuid</span><span class="font-mono text-xs truncate max-w-56">{{ current.uuid }}</span></div>
      </section>

      <!-- Shell (ADR-029) -->
      <section class="rounded-xl border border-line bg-bg-1/60 p-4">
        <h3 class="text-muted text-xs font-semibold uppercase tracking-widest mb-2">Shell</h3>
        <div class="flex justify-between text-sm mb-1">
          <span class="text-muted">status</span>
          <span class="font-mono" :class="shellPhaseClass">{{ shell?.phase || '—' }}</span>
        </div>
        <div v-if="shell?.reason" class="flex justify-between text-sm mb-1">
          <span class="text-warn">reason</span>
          <span class="font-mono text-warn">{{ shell.reason }}</span>
        </div>
        <p class="text-muted text-sm mb-2">
          Terminals run in a separate pod. Lazy shells stop when no terminal has been
          open for a while, and the next terminal you open starts one again.
        </p>
        <div class="flex items-end gap-2">
          <div class="flex-1">
            <label class="text-muted text-label uppercase tracking-widest text-xs">Mode</label>
            <select
              :value="shell?.mode || ''"
              :disabled="shellBusy || !shell"
              class="w-full mt-1 rounded border border-line bg-bg-0 text-text text-sm px-2 py-1.5"
              @change="applyShellMode($event.target.value)"
            >
              <option value="" disabled>—</option>
              <option v-for="m in SHELL_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Resources -->
      <section class="rounded-xl border border-line bg-bg-1/60 p-4">
        <h3 class="text-muted text-xs font-semibold uppercase tracking-widest mb-2">Resources</h3>
        <p class="text-muted text-sm mb-2">Applying a template restarts the pod.</p>
        <div class="flex items-end gap-2">
          <div class="flex-1">
            <label class="text-muted text-label uppercase tracking-widest text-xs">Template</label>
            <select v-model="selectedTemplate" class="w-full mt-1 rounded border border-line bg-bg-0 text-text text-sm px-2 py-1.5">
              <option value="" disabled>Select a template…</option>
              <option v-for="t in templates" :key="t.name" :value="t.name">
                {{ t.name }} — {{ t.resources.limits.cpu }} / {{ t.resources.limits.memory }}
              </option>
            </select>
          </div>
          <UiButton :disabled="busy || !selectedTemplate" @click="applyTemplate">Apply</UiButton>
        </div>
      </section>

      <!-- Image tag -->
      <section class="rounded-xl border border-line bg-bg-1/60 p-4">
        <h3 class="text-muted text-xs font-semibold uppercase tracking-widest mb-2">Workspace image</h3>
        <p v-if="registryError" class="text-muted text-sm">No registry configured — using the imported image.</p>
        <div v-else class="flex items-end gap-2">
          <div class="flex-1">
            <label class="text-muted text-label uppercase tracking-widest text-xs">Tag</label>
            <select v-model="selectedImageTag" class="w-full mt-1 rounded border border-line bg-bg-0 text-text text-sm px-2 py-1.5">
              <option value="" disabled>Select a tag…</option>
              <option v-for="tag in workspaceImages" :key="tag" :value="tag">{{ tag }}</option>
            </select>
          </div>
          <UiButton :disabled="busy || !selectedImageTag" @click="applyImageTag">Apply</UiButton>
        </div>
      </section>

      <!-- Roll -->
      <section class="rounded-xl border border-warn/40 bg-bg-1/60 p-4">
        <h3 class="text-warn text-xs font-semibold uppercase tracking-widest mb-2">Restart</h3>
        <p class="text-muted text-sm mb-3">Roll the workspace pod now. Live terminals and shell sessions are dropped.</p>
        <UiButton variant="warn" :disabled="busy" @click="roll">Restart workspace</UiButton>
      </section>

      <p v-if="error" class="text-warn text-sm">{{ error }}</p>
    </div>
  </Dialog>
</template>
