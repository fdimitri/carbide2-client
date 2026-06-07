<template>
  <div id="app-shell" class="flex flex-col h-[100dvh] overflow-hidden bg-bg-0">
    <nav id="app-nav" v-if="$route.path !== '/login'"
      class="flex justify-between items-center shrink-0 px-5 py-0 h-11 bg-bg-0/95 border-b border-line/80 backdrop-blur-sm"
    >
      <div id="app-nav-left" class="flex items-center gap-3 min-w-0">
        <BrandMark v-if="!inWorkspace" :size="22" />
        <!-- In a workspace the project identity collapses into this nav, so the
             pane area gets a single top bar instead of two stacked headers.
             The C2 mark moves down into the menubar (VS Code style). -->
        <template v-if="inWorkspace">
          <button
            class="shrink-0 inline-flex items-center gap-1 text-muted text-xs hover:text-accent transition-colors"
            title="Back to dashboard" @click="exitToDashboard"
          >← <span class="hidden sm:inline">Dashboard</span></button>
          <span class="text-dim">/</span>
          <span class="text-text font-semibold text-sm truncate">{{ workspaceStore.projectName || 'Loading…' }}</span>
        </template>
      </div>
      <div id="app-nav-right" v-if="authService.isAuthenticated" class="flex gap-3 items-center">
        <ConnectionStatus v-if="!inWorkspace" />
        <span class="hidden sm:inline text-dim text-ui-xs font-mono tracking-wide">{{ VERSION_LABEL }}</span>
        <span class="hidden md:inline text-muted text-xs font-mono">{{ authService.currentUser?.email }}</span>
        <button
          class="px-3 py-1 text-xs rounded border border-warn/50 text-warn bg-transparent cursor-pointer hover:bg-warn/10 transition-colors"
          @click="logout">Logout</button>
      </div>
    </nav>
    <main
      id="app-main"
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
      class="fixed inset-0 z-[9999] grid place-items-center bg-bg-0/80 backdrop-blur-sm"
    >
      <div class="w-[min(92vw,26rem)] rounded-lg border border-line/90 bg-bg-1 p-6 text-center shadow-2xl">
        <div class="text-accent font-mono text-xs tracking-[0.2em] uppercase opacity-70 mb-2">Session expired</div>
        <h2 class="text-text text-base font-semibold mb-1">Your session has expired</h2>
        <p class="text-muted text-sm mb-5">
          For your security you’ve been signed out. Log back in to continue —
          your open workspace stays as it is.
        </p>
        <button
          class="w-full px-3 py-2 text-sm rounded border border-accent text-accent-fg bg-sel cursor-pointer hover:bg-accent/20 transition-colors"
          @click="reauthenticate"
        >Log in again</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import BrandMark from './components/BrandMark.vue'
import { VERSION_LABEL } from './version'
import ConnectionStatus from './components/ConnectionStatus.vue'
import authService from './services/authService'
import workerSocket from './services/workerSocket'
import { useWorkspaceStore } from './stores/workspaceStore'

const router = useRouter()
const route = useRoute()
const workspaceStore = useWorkspaceStore()

// True while a project workspace is open (route like /projects/1). Drives the
// collapsed single top-bar layout (project identity lives in the shared nav).
const inWorkspace = computed(() => route.path.startsWith('/projects/'))

const sessionExpired = computed(() => authService.sessionExpired.value)

// Model B: a workspace pod hosts one project and has no in-pod dashboard, so a
// router.push('/dashboard') is bounced straight back into the project by the
// route guard. The real multi-project dashboard is the control-plane app at the
// origin root; leaving the pod needs a full-page navigation (the inverse of the
// dashboard's window.location.href = '/w/<id>/' drill-in).
function exitToDashboard() {
  window.location.href = '/'
}

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


