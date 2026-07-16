<!-- UiButton — shared button primitive used by panes, dialogs, and forms.
     Uses semantic ui-btn classes from main.css so tone/size rules live in one
     stylesheet instead of repeated utility strings in templates. -->
<template>
  <button :class="cls" :disabled="disabled">
    <slot />
  </button>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  variant:  { type: String,  default: 'ghost' },  // primary | ghost | mono | focus | warn
  size:     { type: String,  default: 'sm' },     // 'xs' | 'sm' | 'md'
  disabled: { type: Boolean, default: false },
})

const SIZES = {
  xs: 'ui-btn ui-btn-sm px-2 py-1 text-ui-xs',
  sm: 'ui-btn ui-btn-sm',
  md: 'ui-btn',
}

const VARIANTS = {
  ghost:   'ui-btn-ghost',
  primary: 'ui-btn-primary',
  mono:    'ui-btn-mono',
  focus:   'ui-btn-focus',
  warn:    'ui-btn-warn',
}

const cls = computed(() => [
  'select-none',
  SIZES[props.size] || SIZES.sm,
  VARIANTS[props.variant] || VARIANTS.ghost,
])
</script>
