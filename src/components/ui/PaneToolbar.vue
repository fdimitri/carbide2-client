<template>
  <div :class="toolbarClass">
    <slot />
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  compact: { type: Boolean, default: true },
  bordered: { type: Boolean, default: true },
})

const toolbarClass = computed(() => {
  const paddingClass = props.compact ? 'px-3 py-1.5' : 'px-3 py-2'
  const borderClass = props.bordered ? 'border-b monaco-panel-border' : ''
  return `flex items-center gap-2 monaco-tabs-bg ${paddingClass} ${borderClass}`.trim()
})
</script>
