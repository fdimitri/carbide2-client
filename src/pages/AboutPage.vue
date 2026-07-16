<template>
  <div class="min-h-screen bg-bg-0 flex flex-col items-center px-6 py-16 font-ui">
    <div class="w-full max-w-2xl">

      <div class="text-muted text-xs font-mono tracking-widest uppercase mb-7">
        <span class="text-accent">◈</span> Carbide2
      </div>

      <h1 class="text-text font-light text-4xl tracking-wide mb-1">About CARBIDE</h1>
      <p class="text-muted text-sm mb-8">What is CARBIDE? It depends on who you ask.</p>

      <!-- Featured -->
      <div v-if="featured" class="rounded-xl border border-accent/25 bg-accent/5 px-5 py-4 mb-10">
        <div class="text-accent text-ui-2xs font-semibold tracking-widest uppercase mb-1">
          Today's answer
        </div>
        <div class="text-text/80 italic text-base leading-relaxed">
          CARBIDE is&hellip; {{ featured }}
        </div>
      </div>

      <!-- Full list -->
      <h2 class="text-dim text-ui-2xs font-semibold tracking-widest uppercase mb-4">
        All known definitions
      </h2>
      <ul v-if="acronyms.length" class="flex flex-col gap-2">
        <li
          v-for="a in acronyms"
          :key="a"
          class="text-sm px-3 py-2 rounded-lg border transition-colors"
          :class="a === featured
            ? 'text-accent/80 border-accent/20 bg-accent/5'
            : 'text-muted border-transparent hover:border-line hover:text-text hover:bg-bg-1'"
        >{{ a }}</li>
      </ul>
      <p v-else class="text-dim text-sm italic">Loading&hellip;</p>

      <!-- Back -->
      <div class="mt-10 flex gap-4">
        <UiButton
          @click="$router.back()"
          size="sm"
        >&larr; Back</UiButton>
        <a
          :href="`${WORKSPACE_PATH}/login`"
          class="text-dim text-sm border-b border-line pb-px hover:text-text hover:border-text transition-colors no-underline"
        >Sign in &rarr;</a>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import UiButton from '../components/ui/UiButton.vue'

const WORKSPACE_PATH = '/w/1'
const featured  = ref('')
const acronyms  = ref([])

onMounted(async () => {
  try {
    const res = await fetch('/about?format=json')
    if (!res.ok) return
    const data = await res.json()
    featured.value = data.acronym
    if (Array.isArray(data.all)) acronyms.value = data.all
  } catch (_) {}
})
</script>
