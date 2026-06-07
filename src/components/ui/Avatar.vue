<script setup>
// Avatar building block: shows an image when one is provided, otherwise a
// deterministic colour + initials fallback. No avatar images are wired in the
// data layer yet, so in practice this always renders the initials fallback.
import { computed } from 'vue'
import { avatarColor, initials } from '../../composables/useAvatar'

const props = defineProps({
  // Identity used to pick a stable colour (user_id / agent slug).
  id:   { type: [String, Number], default: '' },
  // Display name the initials are derived from.
  name: { type: String, default: '' },
  // Optional image URL; when set, rendered instead of the initials fallback.
  src:  { type: String, default: '' },
})

const color = computed(() => avatarColor(props.id || props.name))
const text  = computed(() => initials(props.name))
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="name"
    class="shrink-0 w-8 h-8 rounded-md object-cover mt-0.5"
  />
  <span
    v-else
    class="shrink-0 grid place-items-center w-8 h-8 rounded-md text-ui-xs font-semibold text-white mt-0.5 select-none"
    :style="{ background: color }"
  >{{ text }}</span>
</template>
