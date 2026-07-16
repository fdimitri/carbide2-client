<template>
  <div :class="wrapperClass">
    <label v-if="label" :for="forId" :class="labelClass">
      {{ label }}
      <slot name="label-extra" />
    </label>
    <slot />
    <p v-if="hint" :class="hintClass">{{ hint }}</p>
    <p v-if="error" class="text-warn text-ui-sm mt-1">{{ error }}</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  label: { type: String, default: '' },
  forId: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  labelClass: {
    type: String,
    default: 'text-muted text-ui-sm font-semibold',
  },
  hintClass: {
    type: String,
    default: 'text-muted text-ui-sm mt-1',
  },
})

const wrapperClass = computed(() =>
  props.compact ? 'flex flex-col gap-1' : 'flex flex-col gap-1.5'
)
</script>
