<template>
  <div :class="headerClass">
    <span :class="titleClass"><slot>{{ title }}</slot></span>
    <div v-if="$slots.actions" class="flex items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  size:  { type: String, default: 'md' }, // md | sm
  tone:  { type: String, default: 'line' }, // line | monaco
})

const headerClass = computed(() => {
  const sizeClass = props.size === 'sm'
    ? 'px-3 py-1.5 text-ui-sm'
    : 'px-3 py-2.5 text-ui-md font-bold'
  const toneClass = props.tone === 'monaco'
    ? 'border-b monaco-panel-border monaco-tabs-bg'
    : 'border-b border-line'
  return `flex items-center justify-between uppercase tracking-wider ${sizeClass} ${toneClass}`
})

const titleClass = computed(() => (props.size === 'sm' ? 'font-semibold text-muted' : ''))
</script>
