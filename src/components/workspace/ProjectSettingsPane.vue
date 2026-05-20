<!-- ProjectSettingsPane — project settings as a workspace pane tab. -->
<template>
  <div class="flex flex-col h-full overflow-y-auto bg-[rgba(13,20,32,0.85)] text-text">
    <div class="max-w-xl w-full mx-auto px-8 py-8">

      <h2 class="text-base font-bold text-text mb-6 tracking-tight">Project Settings</h2>

      <div v-if="loading" class="text-muted text-sm">Loading…</div>

      <template v-else>
        <!-- ── VFS Root ─────────────────────────────────────────────────── -->
        <section class="mb-7">
          <h3 class="text-[0.72rem] font-semibold text-muted uppercase tracking-widest mb-3">VFS Root</h3>

          <label class="block text-[0.82rem] text-text mb-1">Root path on server</label>
          <input
            v-model="form.root_path"
            class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text font-mono text-sm
                   placeholder:text-dim focus:outline-none focus:border-accent transition-all"
            placeholder="/home/user/project"
          />

          <label class="flex items-center gap-2 mt-3 text-[0.82rem] text-text cursor-pointer select-none">
            <input type="checkbox" v-model="form.clean_vfs" class="accent-accent" />
            Wipe VFS database before re-importing (destructive)
          </label>
        </section>

        <!-- ── Flush Settings ─────────────────────────────────────────── -->
        <section class="mb-7">
          <h3 class="text-[0.72rem] font-semibold text-muted uppercase tracking-widest mb-3">Flush Settings</h3>

          <div class="flex gap-4">
            <div class="flex-1">
              <label class="block text-[0.82rem] text-text mb-1">Flush interval (seconds)</label>
              <input
                v-model.number="form.flush_interval_s"
                type="number" min="0.1" step="0.1"
                class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                       focus:outline-none focus:border-accent transition-all"
              />
            </div>
            <div class="flex-1">
              <label class="block text-[0.82rem] text-text mb-1">Byte threshold</label>
              <input
                v-model.number="form.flush_bytes"
                type="number" min="1" step="1"
                class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                       focus:outline-none focus:border-accent transition-all"
              />
            </div>
          </div>
        </section>

        <!-- ── Shell Image ────────────────────────────────────────────── -->
        <section class="mb-7">
          <h3 class="text-[0.72rem] font-semibold text-muted uppercase tracking-widest mb-3">Docker Shell</h3>

          <label class="block text-[0.82rem] text-text mb-1">Container image</label>
          <input
            v-model="form.shell_image"
            class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text font-mono text-sm
                   placeholder:text-dim focus:outline-none focus:border-accent transition-all"
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
          <span v-if="saveError" class="text-[#ffb9c8] text-sm">{{ saveError }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getProjectSettings, updateProjectSettings, setProjectRoot } from '../../services/projectService'
import { listProjects } from '../../services/projectService'

const props = defineProps({
  projectId: { type: Number, required: true },
})

const loading   = ref(true)
const saving    = ref(false)
const savedOk   = ref(false)
const saveError = ref('')

const form = ref({
  root_path:        '',
  clean_vfs:        false,
  flush_interval_s: 0.8,
  flush_bytes:      20,
  shell_image:      '',
})

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

    // Update root path / clean VFS only when needed
    const [projects] = await Promise.all([listProjects()])
    const project = projects.find(p => p.id === props.projectId)
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
