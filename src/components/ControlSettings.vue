<script setup>
import { ref, onMounted } from 'vue'
import Dialog from 'primevue/dialog'
import UiButton from './ui/UiButton.vue'
import UiInput from './ui/UiInput.vue'
import { getMe, getUser, listSettings, updateSetting } from '../services/controlService'
import PasskeyManagement from './PasskeyManagement.vue'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible', 'close'])

const me = ref(null)
const settings = ref([])
const editing = ref({})   // key -> draft value
const error = ref('')

onMounted(load)

async function load() {
  error.value = ''
  try {
    me.value = await getMe()
    if (me.value?.user_id != null) {
      // Enrich with memberships (user#show returns role/control_project_id).
      const detail = await getUser(me.value.user_id)
      me.value.memberships = detail.memberships || []
    }
    settings.value = await listSettings()
    editing.value = {}
  } catch (e) {
    error.value = e.message || 'Failed to load control settings'
  }
}

function close() {
  emit('update:visible', false)
  emit('close')
}

async function save(key) {
  const value = (editing.value[key] ?? '').toString()
  if (!value) return   // don't overwrite a stored value with a blank save
  try {
    await updateSetting(key, value)
    await load()
  } catch (e) {
    error.value = e.message || `Failed to save ${key}`
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Control"
    :style="{ width: '34rem' }"
    @update:visible="$emit('update:visible', $event)"
    @hide="close"
  >
    <div class="flex flex-col gap-4">
      <!-- You -->
      <section class="rounded-xl border border-line bg-bg-1/60 p-4">
        <h3 class="text-muted text-xs font-semibold uppercase tracking-widest mb-2">You</h3>
        <dl v-if="me" class="text-sm space-y-1">
          <div class="flex justify-between gap-3">
            <dt class="text-muted">email</dt>
            <dd class="font-mono truncate">{{ me.email }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">uuid</dt>
            <dd class="font-mono text-xs truncate">{{ me.uuid }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">memberships</dt>
            <dd class="font-mono">{{ me.memberships?.length ?? 0 }}</dd>
          </div>
        </dl>
        <p v-else class="text-muted text-sm">Loading…</p>
      </section>

      <!-- Settings -->
      <section class="rounded-xl border border-line bg-bg-1/60 p-4">
        <h3 class="text-muted text-xs font-semibold uppercase tracking-widest mb-2">Settings</h3>
        <div v-for="s in settings" :key="s.key" class="flex items-center gap-2 py-1">
          <span class="text-sm text-muted w-40 shrink-0 font-mono truncate">{{ s.key }}</span>
          <UiInput v-model="editing[s.key]" class="flex-1" size="small" :placeholder="String(s.value)" />
          <UiButton size="small" @click="save(s.key)">Save</UiButton>
        </div>
        <p v-if="settings.length === 0" class="text-muted text-sm">No settings yet.</p>
      </section>

      <!-- Passkeys -->
      <PasskeyManagement />

      <p v-if="error" class="text-warn text-sm">{{ error }}</p>
    </div>
  </Dialog>
</template>
