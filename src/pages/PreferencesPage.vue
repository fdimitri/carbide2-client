<template>
  <div class="min-h-full bg-bg-0 text-text font-ui">

    <!-- Hero strip -->
    <div class="border-b border-line/70 bg-bg-0/60 px-10 py-10">
      <div class="max-w-3xl mx-auto flex items-end justify-between gap-6">
        <div>
          <p class="text-muted text-xs font-mono uppercase tracking-[0.15em] mb-2">Account</p>
          <h1 class="text-text text-2xl font-bold tracking-tight">User Preferences</h1>
        </div>
        <button @click="router.push('/dashboard')"
          class="px-4 py-2 rounded-lg bg-transparent border border-line text-muted text-sm
                 cursor-pointer hover:border-accent hover:text-text transition-all">
          ← Dashboard
        </button>
      </div>
    </div>

    <div class="max-w-3xl mx-auto px-10 py-10 space-y-10">

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-20 gap-3 text-muted text-sm">
        <span class="animate-spin text-accent">◈</span> Loading…
      </div>

      <template v-else>

        <!-- ── Identity ─────────────────────────────────────────────────── -->
        <section class="rounded-xl border border-line bg-bg-1/60 p-7 space-y-5">
          <h2 class="text-text font-semibold text-sm uppercase tracking-widest text-muted mb-1">Identity</h2>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-muted text-label font-semibold uppercase tracking-widest">First Name</label>
              <input v-model="form.first_name" placeholder="Ada"
                class="px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                       placeholder:text-dim focus:outline-none focus:border-accent transition-all" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-muted text-label font-semibold uppercase tracking-widest">Last Name</label>
              <input v-model="form.last_name" placeholder="Lovelace"
                class="px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                       placeholder:text-dim focus:outline-none focus:border-accent transition-all" />
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-muted text-label font-semibold uppercase tracking-widest">Username</label>
            <input v-model="form.username" placeholder="ada_dev" maxlength="32"
              class="px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                     placeholder:text-dim focus:outline-none focus:border-accent transition-all" />
            <p class="text-dim text-xs font-mono">Shown in chat and other collaborative features. Max 32 chars.</p>
          </div>
        </section>

        <!-- ── Locale & Presentation ────────────────────────────────────── -->
        <section class="rounded-xl border border-line bg-bg-1/60 p-7 space-y-5">
          <h2 class="text-text font-semibold text-sm uppercase tracking-widest text-muted mb-1">Locale &amp; Presentation</h2>
          <div class="flex flex-col gap-1.5">
            <label class="text-muted text-label font-semibold uppercase tracking-widest">Timezone</label>
            <input v-model="form.timezone" placeholder="America/New_York"
              class="px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                     placeholder:text-dim focus:outline-none focus:border-accent transition-all" />
            <p class="text-dim text-xs font-mono">IANA timezone name — e.g. <span class="text-muted">Europe/London</span>, <span class="text-muted">Asia/Tokyo</span></p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-muted text-label font-semibold uppercase tracking-widest">Date Format</label>
            <div class="flex gap-3">
              <label v-for="opt in DATE_FORMATS" :key="opt.value"
                class="flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all text-sm"
                :class="form.date_format === opt.value
                  ? 'border-accent bg-accent/10 text-accent-fg'
                  : 'border-line bg-bg-input text-muted hover:border-accent/50'">
                <input type="radio" :value="opt.value" v-model="form.date_format" class="sr-only" />
                {{ opt.label }}
              </label>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-muted text-label font-semibold uppercase tracking-widest">Theme</label>
            <div class="flex gap-3">
              <label v-for="opt in THEMES" :key="opt.value"
                class="flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all text-sm"
                :class="form.theme === opt.value
                  ? 'border-accent bg-accent/10 text-accent-fg'
                  : 'border-line bg-bg-input text-muted hover:border-accent/50'">
                <input type="radio" :value="opt.value" v-model="form.theme" class="sr-only" />
                {{ opt.label }}
              </label>
            </div>
            <p class="text-dim text-xs font-mono">Additional themes will appear here as they are added.</p>
          </div>
        </section>

        <!-- ── Editor Behaviour ─────────────────────────────────────────── -->
        <section class="rounded-xl border border-line bg-bg-1/60 p-7 space-y-5">
          <h2 class="text-text font-semibold text-sm uppercase tracking-widest text-muted mb-1">Editor</h2>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-muted text-label font-semibold uppercase tracking-widest">Font Size</label>
              <input v-model.number="form.editor_font_size" type="number" min="8" max="32" placeholder="13 (default)"
                class="px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                       placeholder:text-dim focus:outline-none focus:border-accent transition-all" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-muted text-label font-semibold uppercase tracking-widest">Tab Width</label>
              <div class="flex gap-3 pt-1">
                <label v-for="w in [2, 4]" :key="w"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all text-sm"
                  :class="form.tab_width === w
                    ? 'border-accent bg-accent/10 text-accent-fg'
                    : 'border-line bg-bg-input text-muted hover:border-accent/50'">
                  <input type="radio" :value="w" v-model="form.tab_width" class="sr-only" />
                  {{ w }} spaces
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Notifications ────────────────────────────────────────────── -->
        <section class="rounded-xl border border-line bg-bg-1/60 p-7">
          <h2 class="text-text font-semibold text-sm uppercase tracking-widest text-muted mb-5">Notifications</h2>
          <label class="flex items-center gap-3 cursor-pointer select-none group">
            <div class="relative w-10 h-5 rounded-full transition-colors"
              :class="form.notifications_enabled ? 'bg-accent' : 'bg-bg-3'">
              <div class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                :class="form.notifications_enabled ? 'translate-x-5' : 'translate-x-0'"></div>
            </div>
            <span class="text-sm text-text group-hover:text-accent transition-colors">Enable notifications</span>
          </label>
          <!-- hidden checkbox bound to the toggle -->
          <input type="checkbox" v-model="form.notifications_enabled" class="sr-only" />
        </section>

        <!-- ── Actions ──────────────────────────────────────────────────── -->
        <div class="flex items-center gap-4">
          <button @click="save" :disabled="saving"
            class="px-6 py-2.5 rounded-lg bg-accent text-accent-text text-sm font-bold border-0 cursor-pointer
                   hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed
                   shadow-[0_4px_20px_rgba(46,196,182,0.3)]">
            {{ saving ? 'Saving…' : 'Save Preferences' }}
          </button>
          <Transition name="fade">
            <span v-if="saved" class="text-accent text-sm font-mono">✓ Saved</span>
          </Transition>
          <span v-if="saveError" class="text-warn text-sm">{{ saveError }}</span>
        </div>

      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getPreferences, updatePreferences } from '../services/preferencesService'

const router    = useRouter()
const loading   = ref(true)
const saving    = ref(false)
const saved     = ref(false)
const saveError = ref('')

const DATE_FORMATS = [
  { value: 'relative', label: 'Relative (2 hours ago)' },
  { value: 'absolute', label: 'Absolute (2026-05-20)' },
]

const THEMES = [
  { value: 'carbide_default', label: 'CARB/IDE Dev Default' },
]

const form = reactive({
  first_name:            '',
  last_name:             '',
  username:              '',
  timezone:              '',
  theme:                 null,
  date_format:           null,
  editor_font_size:      null,
  tab_width:             null,
  notifications_enabled: true,
})

onMounted(async () => {
  try {
    const prefs = await getPreferences()
    Object.assign(form, {
      first_name:            prefs.first_name            ?? '',
      last_name:             prefs.last_name             ?? '',
      username:              prefs.username              ?? '',
      timezone:              prefs.timezone              ?? '',
      theme:                 prefs.theme                 ?? null,
      date_format:           prefs.date_format           ?? null,
      editor_font_size:      prefs.editor_font_size      ?? null,
      tab_width:             prefs.tab_width             ?? null,
      notifications_enabled: prefs.notifications_enabled ?? true,
    })
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value    = true
  saved.value     = false
  saveError.value = ''
  try {
    // Send null for blank strings so server stores null (use default)
    const payload = {
      ...form,
      first_name:       form.first_name.trim()  || null,
      last_name:        form.last_name.trim()   || null,
      username:         form.username.trim()    || null,
      timezone:         form.timezone.trim()    || null,
    }
    await updatePreferences(payload)
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } catch (e) {
    saveError.value = e.response?.data?.error || e.message || 'Save failed'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.4s }
.fade-enter-from, .fade-leave-to       { opacity: 0 }
</style>
