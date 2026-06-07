<template>
  <div class="relative flex min-h-screen items-center justify-center px-4 workspace-bg overflow-hidden">
    <!-- ambient glows -->
    <div class="pointer-events-none absolute -top-60 -left-60 w-[500px] h-[500px] rounded-full bg-accent/8 blur-[120px]"></div>
    <div class="pointer-events-none absolute -bottom-60 -right-40 w-[400px] h-[400px] rounded-full bg-[rgba(85,130,255,0.08)] blur-[100px]"></div>

    <div class="relative w-full max-w-[360px]">
      <!-- Brand -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center mb-4">
          <BrandMark :size="34" />
        </div>
        <p class="text-muted text-sm">Sign in to your workspace</p>
      </div>

      <!-- Card -->
      <div class="rounded-2xl border border-accent/20 bg-bg-1/85 backdrop-blur-2xl p-10 shadow-[0_32px_80px_rgba(0,0,0,0.7)]">
        <form @submit.prevent="handleLogin" class="flex flex-col gap-5">

          <div class="flex flex-col gap-2">
            <label class="text-muted text-label font-semibold uppercase tracking-widest mb-1" for="email">Email</label>
            <input v-model="email" type="email" id="email" placeholder="test@example.com" required
              class="px-4 py-3 rounded-lg bg-bg-input border border-line text-text text-sm
                     placeholder:text-dim focus:outline-none focus:border-accent
                     focus:shadow-[0_0_0_3px_rgba(90,176,255,0.12)] transition-all" />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-muted text-label font-semibold uppercase tracking-widest mb-1" for="password">Password</label>
            <input v-model="password" type="password" id="password" placeholder="••••••••" required
              class="px-4 py-3 rounded-lg bg-bg-input border border-line text-text text-sm
                     placeholder:text-dim focus:outline-none focus:border-accent
                     focus:shadow-[0_0_0_3px_rgba(90,176,255,0.12)] transition-all" />
          </div>

          <button type="submit" :disabled="loading"
            class="mt-4 w-full py-3.5 rounded-lg font-bold text-sm text-accent-text
                   bg-accent border-0 cursor-pointer
                   hover:brightness-110 active:scale-[0.98] transition-all
                   disabled:opacity-50 disabled:cursor-not-allowed
                   shadow-[0_4px_24px_rgba(90,176,255,0.35)]"
          >{{ loading ? 'Signing in…' : 'Sign in' }}</button>

          <p v-if="error" class="text-warn text-xs text-center -mt-1">{{ error }}</p>
        </form>

        <div class="mt-6 pt-5 border-t border-line/50 text-center">
          <p class="text-dim text-label font-mono tracking-wide">
            demo · test@example.com · password123
          </p>
          <p v-if="acronym" class="mt-4 text-dim/60 text-[0.7rem] italic leading-snug">
            CARBIDE is&hellip; {{ acronym }}
          </p>
        </div>
      </div>

      <p class="mt-6 text-center text-dim text-[0.7rem] font-mono tracking-wide">{{ VERSION_LABEL }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { VERSION_LABEL } from '../version'
import authService from '../services/authService'

const email = ref('test@example.com')
const password = ref('password123')
const loading = ref(false)
const error = ref('')
const router = useRouter()
const acronym = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/about')
    if (res.ok) acronym.value = (await res.json()).acronym
  } catch (_) { /* non-fatal */ }
})

const handleLogin = async () => {
  loading.value = true
  error.value = ''

  try {
    await authService.login(email.value, password.value)
    router.push('/dashboard')
  } catch (err) {
    error.value = err.message || 'Login failed. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>


