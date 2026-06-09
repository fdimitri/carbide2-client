<template>
  <input
    type="checkbox"
    :id="id"
    :checked="checked"
    :value="value"
    :disabled="disabled"
    :readonly="readonly"
    :class="checkboxClass"
    @change="onChange"
  />
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: [Boolean, Array], default: false },
  value:      { type: [String, Number, Boolean], default: undefined },
  id:         { type: String,  default: '' },
  tone:       { type: String,  default: 'accent' }, // accent | warn
  disabled:   { type: Boolean, default: false },
  readonly:   { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const checkboxClass = computed(() => [
  'ui-checkbox',
  props.tone === 'warn' ? 'ui-checkbox--warn' : 'ui-checkbox--accent',
])

const checked = computed(() => {
  if (Array.isArray(props.modelValue)) {
    return props.modelValue.includes(props.value)
  }
  return !!props.modelValue
})

function onChange(e) {
  const isChecked = e.target.checked
  if (Array.isArray(props.modelValue)) {
    const next = [...props.modelValue]
    const idx = next.indexOf(props.value)
    if (isChecked && idx === -1) next.push(props.value)
    if (!isChecked && idx !== -1) next.splice(idx, 1)
    emit('update:modelValue', next)
    return
  }
  emit('update:modelValue', isChecked)
}
</script>
