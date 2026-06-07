<!-- ProjectSettingsPane — project settings as a workspace pane tab. -->
<template>
  <div class="flex flex-col h-full overflow-y-auto bg-bg-1/85 text-text">
    <div class="max-w-xl w-full mx-auto px-8 py-8">

      <h2 class="text-base font-bold text-text mb-6 tracking-tight">Project Settings</h2>

      <div v-if="loading" class="text-muted text-sm">Loading…</div>

      <template v-else>
        <!-- ── VFS Root ─────────────────────────────────────────────────── -->
        <section class="mb-7">
          <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">VFS Root</h3>

          <FieldLabel label="Root path on server" helpKey="root_path" :openHelp="openHelp" :activeHelp="activeHelp" />
          <HelpText helpKey="root_path" :activeHelp="activeHelp">
            The directory on the server whose contents are imported into the in-database virtual filesystem.
            The worker reads from and writes to this path on disk.
          </HelpText>
          <UiInput
            v-model="form.root_path"
            mono
            class="w-full"
            placeholder="/home/user/project"
          />

          <div class="mt-3">
            <label class="flex items-center gap-2 text-ui-md text-text cursor-pointer select-none w-fit" @click.prevent="onWipeCheckboxClick">
              <input type="checkbox" :checked="form.clean_vfs" class="accent-accent pointer-events-none" readonly />
              Wipe VFS database before re-importing
              <span
                class="inline-flex items-center justify-center w-4 h-4 rounded-full border border-muted text-ui-2xs text-muted cursor-pointer hover:border-accent hover:text-accent transition-colors leading-none"
                @click.stop="openHelp('clean_vfs')"
              >?</span>
            </label>
            <HelpText helpKey="clean_vfs" :activeHelp="activeHelp">
              When checked, all existing file history stored in the database will be permanently deleted
              before the project root is re-imported. Use this to reset a project's VFS to match what
              is currently on disk.
            </HelpText>
          </div>
        </section>

        <!-- ── Flush Settings ─────────────────────────────────────────── -->
        <section class="mb-7">
          <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Flush Settings</h3>

          <div class="flex gap-4">
            <div class="flex-1">
              <FieldLabel label="Flush interval (seconds)" helpKey="flush_interval_s" :openHelp="openHelp" :activeHelp="activeHelp" />
              <HelpText helpKey="flush_interval_s" :activeHelp="activeHelp">
                Pending file changes will be written to disk at least every
                <strong class="text-text">{{ form.flush_interval_s }}s</strong> if there are any,
                unless the byte threshold is crossed first and triggers an earlier flush.
              </HelpText>
              <UiInput
                v-model.number="form.flush_interval_s"
                type="number" min="0.1" step="0.1"
                class="w-full"
              />
            </div>
            <div class="flex-1">
              <FieldLabel label="Byte threshold" helpKey="flush_bytes" :openHelp="openHelp" :activeHelp="activeHelp" />
              <HelpText helpKey="flush_bytes" :activeHelp="activeHelp">
                As soon as
                <strong class="text-text">{{ form.flush_bytes }} bytes</strong> of accumulated edits
                are waiting, the file is flushed to disk immediately — without waiting for the
                interval timer.
              </HelpText>
              <UiInput
                v-model.number="form.flush_bytes"
                type="number" min="1" step="1"
                class="w-full"
              />
            </div>
          </div>
        </section>

        <!-- ── Shell Image ────────────────────────────────────────────── -->
        <section class="mb-7">
          <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Docker Shell</h3>

          <FieldLabel label="Container image" helpKey="shell_image" :openHelp="openHelp" :activeHelp="activeHelp" />
          <HelpText helpKey="shell_image" :activeHelp="activeHelp">
            The Docker image used for terminal sessions in this project.
            Leave blank to use the server default (<code class="font-mono text-accent">ubuntu:24.04</code>).
            The image must be accessible to the Docker daemon on the server.
          </HelpText>
          <UiInput
            v-model="form.shell_image"
            mono
            class="w-full"
            placeholder="ubuntu:24.04 (default)"
          />
        </section>

        <!-- ── Actions ────────────────────────────────────────────────── -->
        <div class="flex items-center gap-3">
          <button
            :disabled="saving"
            class="px-5 py-2 rounded-lg bg-accent text-accent-text text-sm font-bold border-0 cursor-pointer
                   hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            @click="save"
          >{{ saving ? 'Saving…' : 'Save' }}</button>

          <span v-if="savedOk" class="text-accent text-sm">Saved.</span>
          <span v-if="saveError" class="text-warn text-sm">{{ saveError }}</span>
        </div>
      </template>
    </div>
  </div>

  <!-- ── Wipe confirmation modal ────────────────────────────────────────────── -->
  <Dialog v-model:visible="showWipeConfirm" modal :closable="false" :style="{ width: '32rem' }">
    <template #header>
      <span class="text-warn font-bold text-base tracking-tight">⚠ Are you absolutely sure?</span>
    </template>

    <p class="text-text text-sm mb-2">
      This change <strong class="text-warn">CANNOT BE REVERTED</strong>. You will
      <strong class="text-warn">PERMANENTLY LOSE ALL FILE HISTORY</strong> stored in the
      database for this project.
    </p>
    <p class="text-muted text-sm mb-4">
      The project root will be re-imported from disk from scratch after Save.
    </p>

    <label class="flex items-start gap-2 cursor-pointer select-none text-sm text-text">
      <input type="checkbox" v-model="wipeConfirmed" class="accent-warn mt-[0.15rem] shrink-0" />
      Yes, I really want to lose all my data.
    </label>

    <template #footer>
      <div class="flex items-center gap-3 w-full">
        <button
          class="flex-1 px-4 py-2 rounded-lg bg-sel border-2 border-accent text-accent-fg font-bold text-sm cursor-pointer hover:brightness-110 transition-all"
          @click="cancelWipe"
        >CANCEL — GO BACK</button>
        <button
          :disabled="!wipeConfirmed"
          class="px-4 py-2 rounded-lg bg-warn/15 border border-warn text-warn text-sm font-bold cursor-pointer
                 hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          @click="confirmWipe"
        >I'm REALLY sure</button>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, onMounted, defineComponent, h } from 'vue'
import Dialog from 'primevue/dialog'
import { getProjectSettings, updateProjectSettings, setProjectRoot, listProjects } from '../../services/projectService'
import UiInput from '../ui/UiInput.vue'

// ── Inline helper components ──────────────────────────────────────────────────

// FieldLabel — label + clickable (?) icon
const FieldLabel = defineComponent({
  props: { label: String, helpKey: String, openHelp: Function, activeHelp: String },
  setup(props) {
    return () => h('div', { class: 'flex items-center gap-1.5 mb-1' }, [
      h('label', { class: 'text-ui-md text-text' }, props.label),
      h('button', {
        type: 'button',
        class: [
          'inline-flex items-center justify-center w-4 h-4 rounded-full border text-ui-2xs leading-none transition-colors',
          props.activeHelp === props.helpKey
            ? 'border-accent text-accent bg-accent/10'
            : 'border-muted text-muted hover:border-accent hover:text-accent',
        ],
        onClick: () => props.openHelp(props.helpKey),
      }, '?'),
    ])
  },
})

// HelpText — collapsible explanation paragraph
const HelpText = defineComponent({
  props: { helpKey: String, activeHelp: String },
  slots: ['default'],
  setup(props, { slots }) {
    return () => props.activeHelp === props.helpKey
      ? h('p', { class: 'text-ui-md text-muted leading-relaxed mb-2 px-3 py-2 rounded-lg bg-bg-2/60 border border-line' },
          slots.default?.())
      : null
  },
})

// ── Component state ───────────────────────────────────────────────────────────

const props = defineProps({
  projectId: { type: Number, required: true },
})

const loading   = ref(true)
const saving    = ref(false)
const savedOk   = ref(false)
const saveError = ref('')
const activeHelp = ref(null)

const form = ref({
  root_path:        '',
  clean_vfs:        false,
  flush_interval_s: 0.8,
  flush_bytes:      20,
  shell_image:      '',
})

// Wipe confirmation
const showWipeConfirm = ref(false)
const wipeConfirmed   = ref(false)

function openHelp(key) {
  activeHelp.value = activeHelp.value === key ? null : key
}

function onWipeCheckboxClick() {
  if (!form.value.clean_vfs) {
    // About to enable — show confirmation first
    wipeConfirmed.value = false
    showWipeConfirm.value = true
  } else {
    form.value.clean_vfs = false
  }
}

function cancelWipe() {
  showWipeConfirm.value = false
  wipeConfirmed.value   = false
  form.value.clean_vfs  = false
}

function confirmWipe() {
  showWipeConfirm.value = false
  form.value.clean_vfs  = true
}

// ── Data loading ──────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    const [projects, settings] = await Promise.all([
      listProjects(),
      getProjectSettings(props.projectId),
    ])
    const project = projects.find(p => p.id === props.projectId)
    form.value = {
      root_path:        project?.root_path ?? '',
      clean_vfs:        false,
      flush_interval_s: settings.flush_interval_s ?? 0.8,
      flush_bytes:      settings.flush_bytes      ?? 20,
      shell_image:      settings.shell_image      ?? '',
    }
  } catch (e) {
    saveError.value = 'Failed to load settings: ' + (e.message || e)
  } finally {
    loading.value = false
  }
})

// ── Save ──────────────────────────────────────────────────────────────────────

async function save() {
  saving.value    = true
  savedOk.value   = false
  saveError.value = ''
  try {
    await updateProjectSettings(props.projectId, {
      flush_interval_s: form.value.flush_interval_s,
      flush_bytes:      form.value.flush_bytes,
      shell_image:      form.value.shell_image || null,
    })

    const projects = await listProjects()
    const project  = projects.find(p => p.id === props.projectId)
    if (form.value.root_path !== (project?.root_path ?? '') || form.value.clean_vfs) {
      await setProjectRoot(props.projectId, form.value.root_path, form.value.clean_vfs)
      form.value.clean_vfs = false
    }

    savedOk.value = true
    setTimeout(() => { savedOk.value = false }, 3000)
  } catch (e) {
    saveError.value = e.response?.data?.error || e.message || 'Save failed'
  } finally {
    saving.value = false
  }
}
</script>
