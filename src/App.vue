<template>
  <div class="flex flex-col h-[100dvh] overflow-hidden bg-bg-0">
    <nav v-if="$route.path !== '/login'"
      class="flex justify-between items-center shrink-0 px-6 py-0 h-11 bg-[rgba(8,9,13,0.95)] border-b border-line/80 backdrop-blur-sm"
    >
      <div class="flex items-center gap-3">
        <BrandMark :size="22" />
      </div>
      <div v-if="authService.isAuthenticated" class="flex gap-3 items-center">
        <ConnectionStatus />
        <span class="hidden sm:inline text-dim text-[0.7rem] font-mono tracking-wide">{{ VERSION_LABEL }}</span>
        <span class="text-muted text-xs font-mono">{{ authService.currentUser?.email }}</span>
        <button
          class="px-3 py-1 text-xs rounded border border-warn/50 text-warn bg-transparent cursor-pointer hover:bg-warn/10 transition-colors"
          @click="logout">Logout</button>
      </div>
    </nav>
    <main
      class="flex-1 min-h-0 overflow-auto"
      :class="$route.path.startsWith('/projects/') ? 'flex flex-col overflow-hidden' : ''"
    >
      <router-view />
    </main>

    <!-- Session-expired overlay. Shown when a silent token refresh has failed,
         i.e. the upstream session is truly gone. Blocks the workspace but keeps
         the page mounted so the user re-authenticates in place. -->
    <div
      v-if="sessionExpired"
      class="fixed inset-0 z-[9999] grid place-items-center bg-[rgba(6,10,16,0.82)] backdrop-blur-sm"
    >
      <div class="w-[min(92vw,26rem)] rounded-lg border border-[rgba(43,61,88,0.9)] bg-[#0d1219] p-6 text-center shadow-2xl">
        <div class="text-accent font-mono text-xs tracking-[0.2em] uppercase opacity-70 mb-2">◈ Session expired</div>
        <h2 class="text-text text-base font-semibold mb-1">Your session has expired</h2>
        <p class="text-muted text-sm mb-5">
          For your security you’ve been signed out. Log back in to continue —
          your open workspace stays as it is.
        </p>
        <button
          class="w-full px-3 py-2 text-sm rounded border border-accent text-[#cfe8ff] bg-[#10243a] cursor-pointer hover:bg-[#163a5a] transition-colors"
          @click="reauthenticate"
        >Log in again</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import BrandMark from './components/BrandMark.vue'
import { VERSION_LABEL } from './version'
import ConnectionStatus from './components/ConnectionStatus.vue'
import authService from './services/authService'
import workerSocket from './services/workerSocket'

const router = useRouter()

const sessionExpired = computed(() => authService.sessionExpired.value)

function logout() {
  authService.logout()
  router.push('/login')
}

// Tear down the dead socket and send the user to login. After a fresh login the
// workspace route remounts and reconnects the worker socket with new creds.
function reauthenticate() {
  workerSocket.disconnect()
  authService.sessionExpired.value = false
  authService.logout()
  router.push('/login')
}
</script>


