<template>
  <UiButton :variant="variant" :size="size" :disabled="disabled">
    <slot />
  </UiButton>
</template>

<script setup>
import UiButton from './UiButton.vue'

defineProps({
  variant: { type: String, default: 'ghost' },
  size: { type: String, default: 'sm' },
  disabled: { type: Boolean, default: false },
})
</script>
