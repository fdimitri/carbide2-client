<script setup>
import { ref, onMounted } from 'vue'
import UiButton from './ui/UiButton.vue'
import UiInput from './ui/UiInput.vue'
import { listPasskeys, removePasskey } from '../services/controlService'
import { registerPasskey } from '../services/webauthn'

const passkeys = ref([])
const nickname = ref('')
const busy = ref(false)
const error = ref('')

async function load() {
  try {
    passkeys.value = await listPasskeys()
  } catch (e) {
    error.value = e.message || 'Failed to load passkeys'
  }
}

async function add() {
  error.value = ''
  busy.value = true
  try {
    await registerPasskey(nickname.value.trim() || 'Passkey')
    nickname.value = ''
    await load()
  } catch (e) {
    error.value = e.message || 'Failed to register passkey'
  } finally {
    busy.value = false
  }
}

async function remove(id) {
  error.value = ''
  try {
    await removePasskey(id)
    await load()
  } catch (e) {
    error.value = e.message || 'Failed to remove passkey'
  }
}

onMounted(load)
</script>

<template>
  <section class="rounded-xl border border-line bg-bg-1/60 p-4">
    <h3 class="text-muted text-xs font-semibold uppercase tracking-widest mb-2">Passkeys</h3>

    <div v-if="passkeys.length === 0" class="text-muted text-sm mb-3">
      No passkeys registered.
    </div>
    <ul v-else class="space-y-2 mb-3">
      <li v-for="p in passkeys" :key="p.id" class="flex items-center justify-between gap-2">
        <span class="text-sm text-text">{{ p.nickname }}</span>
        <div class="flex items-center gap-2">
          <span class="text-xs text-dim font-mono">{{ new Date(p.created_at).toLocaleDateString() }}</span>
          <UiButton size="xs" variant="warn" @click="remove(p.id)">Remove</UiButton>
        </div>
      </li>
    </ul>

    <div class="flex items-end gap-2">
      <UiInput v-model="nickname" class="flex-1" placeholder="Name (e.g. YubiKey)" />
      <UiButton :disabled="busy" @click="add">{{ busy ? 'Registering…' : 'Add passkey' }}</UiButton>
    </div>

    <p v-if="error" class="text-warn text-sm mt-2">{{ error }}</p>
  </section>
</template>
