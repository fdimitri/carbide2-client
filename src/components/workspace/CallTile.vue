<!-- CallTile — one video tile in a channel call. Binds a MediaStream to a
     <video> imperatively (srcObject can't be set via a template binding). -->
<template>
  <div class="relative shrink-0 w-[150px] h-[112px] rounded-ui-md overflow-hidden bg-black border monaco-panel-border">
    <video
      ref="videoEl"
      autoplay
      playsinline
      :muted="muted"
      class="w-full h-full object-cover"
      :class="hasVideo ? '' : 'opacity-0'"
    ></video>
    <div v-if="!hasVideo" class="absolute inset-0 flex items-center justify-center text-muted text-ui-2xl font-semibold">
      {{ initials }}
    </div>
    <span class="absolute bottom-0 left-0 right-0 px-1 py-[0.1rem] text-ui-2xs text-white bg-black/55 truncate">
      {{ label }}
    </span>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'

const props = defineProps({
  stream: { type: Object,  default: null },
  label:  { type: String,  default: '' },
  muted:  { type: Boolean, default: false },
})

const videoEl  = ref(null)
const hasVideo = ref(false)

const initials = computed(() =>
  (props.label || '?').trim().slice(0, 2).toUpperCase()
)

function bind() {
  if (!videoEl.value) return
  videoEl.value.srcObject = props.stream || null
  updateHasVideo()
}

function updateHasVideo() {
  const tracks = props.stream?.getVideoTracks?.() || []
  hasVideo.value = tracks.some(t => t.enabled && t.readyState === 'live')
}

onMounted(bind)
watch(() => props.stream, bind)
// Mute/camera toggles flip track.enabled without changing the stream object,
// so poll lightly to keep the avatar fallback in sync.
let poll = null
onMounted(() => { poll = setInterval(updateHasVideo, 500) })
onBeforeUnmount(() => clearInterval(poll))
</script>
