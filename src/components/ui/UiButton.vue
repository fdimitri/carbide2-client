<!-- UiButton — the single place button padding, surface, and hover live.
     Variants: primary (filled accent) · ghost (bordered, subtle).
     Sizes: xs · sm · md. Everything else (title, @click, type, …) falls
     through via $attrs. This exists so buttons stop being copy-pasted
     utility strings that drift a hair apart in every file. -->
<template>
  <button :class="cls" :disabled="disabled">
    <slot />
  </button>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  variant:  { type: String,  default: 'ghost' },  // 'primary' | 'ghost'
  size:     { type: String,  default: 'sm' },     // 'xs' | 'sm' | 'md'
  disabled: { type: Boolean, default: false },
})

const SIZES = {
  xs: 'px-2.5 py-1 text-ui-xs',
  sm: 'px-2.5 py-2 text-ui-md',
  md: 'px-3.5 py-2 text-ui-lg',
}

const VARIANTS = {
  ghost:   'rounded-ui-sm border monaco-panel-border opacity-80 hover:opacity-100 disabled:opacity-30 disabled:cursor-default cursor-pointer',
  primary: 'rounded-ui-sm border-0 text-white monaco-focus-bg hover:brightness-115 disabled:opacity-40 disabled:cursor-default cursor-pointer',
}

const cls = computed(() => [
  'inline-flex items-center justify-center gap-1.5 font-[inherit] select-none',
  SIZES[props.size] || SIZES.sm,
  VARIANTS[props.variant] || VARIANTS.ghost,
])
</script>
