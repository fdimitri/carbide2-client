<script setup>
// Shared form field (blue-steel token surfaces: prefs, dashboard, login, agent
// config, project settings). Defines the field's spacing/border/focus ONCE so
// the ~20 hand-rolled copies collapse to one block. Renders <input> by default,
// or <textarea>/<select> via `as`. v-model works on all three; placeholder,
// type, rows, autocomplete etc. fall through as $attrs. Width is left to the
// caller (add class="w-full" where needed).
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  modelModifiers: { default: () => ({}) },
  as:   { type: String, default: 'input' },   // 'input' | 'textarea' | 'select'
  size: { type: String, default: 'sm' },       // 'sm' (px-3 py-2) | 'lg' (px-4 py-3)
  text: { type: String, default: 'text-sm' },  // text-size utility (override for e.g. textareas)
  mono: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const SIZES = { sm: 'px-3 py-2', lg: 'px-4 py-3' }

const classes = computed(() => [
  'rounded-lg bg-bg-input border border-line text-text',
  'placeholder:text-dim focus:outline-none focus:border-accent transition-all',
  SIZES[props.size] || SIZES.sm,
  props.text,
  props.mono ? 'font-mono' : '',
  props.as === 'textarea' ? 'resize-y' : '',
])

function onUpdate(e) {
  let v = e.target.value
  if (props.modelModifiers.number) v = v === '' ? '' : Number(v)
  else if (props.modelModifiers.trim) v = v.trim()
  emit('update:modelValue', v)
}
</script>

<template>
  <component
    :is="as"
    :class="classes"
    :value="modelValue"
    @input="onUpdate"
    @change="onUpdate"
  >
    <slot />
  </component>
</template>
