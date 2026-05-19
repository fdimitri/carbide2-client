<template>
  <div class="flex flex-col h-[100dvh] overflow-hidden bg-[#0d1219]">
    <nav v-if="$route.path !== '/login'"
      class="flex justify-between items-center shrink-0 px-6 py-0 h-11 bg-[rgba(11,18,28,0.95)] border-b border-[rgba(43,61,88,0.8)] backdrop-blur-sm"
    >
      <div class="flex items-center gap-3">
        <span class="text-accent font-mono text-xs tracking-[0.2em] uppercase opacity-70">◈</span>
        <span class="text-text font-bold text-sm tracking-wide">Carbide2 IDE</span>
      </div>
      <div v-if="authService.isAuthenticated" class="flex gap-3 items-center">
        <span class="text-muted text-xs font-mono">{{ authService.currentUser?.email }}</span>
        <button
          class="px-3 py-1 text-xs rounded border border-[rgba(240,113,103,0.5)] text-[#f07167] bg-transparent cursor-pointer hover:bg-[rgba(240,113,103,0.12)] transition-colors"
          @click="logout">Logout</button>
      </div>
    </nav>
    <main
      class="flex-1 min-h-0 overflow-auto"
      :class="$route.path.startsWith('/projects/') ? 'flex flex-col overflow-hidden' : ''"
    >
      <router-view />
    </main>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import authService from './services/authService'

export default {
  setup() {
    const router = useRouter()

    const logout = () => {
      authService.logout()
      router.push('/login')
    }

    return {
      authService,
      logout,
    }
  },
}
</script>

<script setup>
import { useRouter } from 'vue-router'
</script>


