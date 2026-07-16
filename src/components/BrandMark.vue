<!--
  BrandMark — the CARB/IDE2 logo lockup. Reuses the C2 glyph from carbide2-site
  (the rounded-square mark with a blinking terminal cursor) plus the "CARB/IDE2"
  wordmark. The mark inherits `currentColor` so callers can tint it; default is
  brand blue.

  Props:
    size      — square px size of the mark (default 24)
    wordmark  — show the "CARB/IDE2" text beside the mark (default true)
    tagline   — optional muted tagline shown after the wordmark
-->
<template>
  <span class="inline-flex items-center gap-2 select-none">
    <svg
      :width="size" :height="size" viewBox="0 0 64 64"
      class="shrink-0 text-accent" role="img" aria-label="CARB/IDE2"
    >
      <rect x="5" y="5" width="54" height="54" rx="9"
            fill="none" stroke="currentColor" stroke-width="2.5" />
      <text x="32" y="41" text-anchor="middle"
            font-family="'JetBrains Mono', ui-monospace, monospace"
            font-size="24" font-weight="700" fill="currentColor">C2</text>
      <rect x="45" y="45" width="6" height="10" fill="currentColor">
        <animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite" />
      </rect>
    </svg>
    <span v-if="wordmark" class="inline-flex items-baseline gap-2 font-mono font-bold tracking-tight">
      <span class="text-accent glow-text">CARB/IDE2</span>
      <span v-if="tagline" class="hidden sm:inline text-muted font-normal text-ui-sm">{{ tagline }}</span>
    </span>
  </span>
</template>

<script setup>
defineProps({
  size:     { type: [Number, String], default: 24 },
  wordmark: { type: Boolean, default: true },
  tagline:  { type: String, default: '' },
})
</script>
