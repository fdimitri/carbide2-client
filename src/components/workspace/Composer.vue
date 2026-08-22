<!-- Composer — the agent input box: text draft + image attachments.
     Kept as its own component so keystrokes only re-render this small
     tree, never AgentPane's (potentially long) message timeline. -->
<template>
  <div
    ref="barEl"
    class="relative flex flex-col gap-1.5 p-2 border-t monaco-panel-border monaco-tabs-bg"
    :class="dragOver ? 'ring-2 ring-blue-500/60 ring-inset' : ''"
    :style="barHeight ? { height: barHeight + 'px' } : undefined"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <!-- Resize handle: drag up/down to size the whole bottom bar -->
    <div
      class="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500/40"
      title="Drag to resize"
      @mousedown.prevent="onResizeStart"
    ></div>
    <div v-if="pendingImages.length" class="flex flex-wrap gap-1.5 shrink-0">
      <div
        v-for="(img, idx) in pendingImages"
        :key="idx"
        class="relative group"
        :title="`${img.mime} · ${formatBytes(img.bytes)}`"
      >
        <img
          :src="`data:${img.mime};base64,${img.base64}`"
          class="h-16 w-16 object-cover rounded-ui-xs border monaco-panel-border"
          :alt="`pending ${idx + 1}`"
        />
        <button
          class="absolute -top-1 -right-1 w-4 h-4 leading-3.5 text-ui-xs rounded-full bg-black/80 text-white opacity-80 hover:opacity-100"
          @click="removePending(idx)"
          title="Remove"
        >×</button>
      </div>
    </div>

    <div class="flex gap-2 flex-1 min-h-0">
      <UiButton
        size="md"
        @click="fileInputEl?.click()"
        :disabled="!canSend"
        title="Attach image(s) (or paste / drag-drop)"
      >📎</UiButton>
      <input
        ref="fileInputEl"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onFileInput"
      />
      <textarea
        v-model="draft"
        ref="inputEl"
        @keydown.enter.exact.prevent="onSend"
        @input="onInputResize"
        @paste="onPaste"
        :placeholder="placeholder"
        :class="fieldSizing && !barHeight ? 'field-sizing-content' : ''"
        :style="textareaStyle"
        class="flex-1 px-2.5 py-2 text-ui-lg rounded-ui-sm outline-none font-[inherit] border monaco-input-bg monaco-input-fg monaco-input-border focus:monaco-focus-border placeholder:monaco-line-fg resize-none min-h-0"
      ></textarea>
      <UiButton
        size="md"
        variant="primary"
        @click="onSend"
        :disabled="!canSend || (!draft.trim() && !pendingImages.length)"
      >Send</UiButton>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import UiButton from '../ui/UiButton.vue'

const props = defineProps({
  connected: { type: Boolean, default: false },
  agentSlug: { type: String, default: null },
  agentStatus: { type: String, default: 'idle' },
})
const emit = defineEmits(['send'])

const store = useWorkspaceStore()

const draft       = ref('')
const inputEl     = ref(null)
const fileInputEl = ref(null)

// ── Composer sizing (#82) ──────────────────────────────────────────────
// barHeight is null until the user drags the resize handle; then it is an
// explicit px height (persisted per workspace pod). In auto mode the bar
// tracks the textarea up to MAX_AUTO_LINES; beyond that the textarea scrolls
// internally and follows the caret.
const barEl    = ref(null)
const MAX_AUTO_LINES = 4
const MIN_BAR_HEIGHT = 48
const MAX_BAR_FRACTION = 0.8

// Native autosize (Chromium 123+): `field-sizing: content` grows the textarea
// with its content without JS measuring scrollHeight on every keystroke. We
// still cap it at MAX_AUTO_LINES via max-height (the field then scrolls
// internally). Other browsers fall back to the manual measure below.
const fieldSizing = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' &&
  CSS.supports('field-sizing', 'content')

// Auto-mode height cap (px) — recomputed once at mount / after the web font
// resolves (line-height changes), not on every keystroke.
const autoMaxHeight = ref(null)

const textareaStyle = computed(() => {
  if (barHeight.value || autoMaxHeight.value == null) return {}
  return { maxHeight: `${autoMaxHeight.value}px` }
})

function lineMetrics() {
  const el = inputEl.value
  if (!el) return null
  const cs = window.getComputedStyle(el)
  const lineH = parseFloat(cs.lineHeight) || 24
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
  return { lineH, pad }
}

function updateAutoMaxHeight() {
  const m = lineMetrics()
  if (m) autoMaxHeight.value = m.lineH * MAX_AUTO_LINES + m.pad
}

function workspaceScope() {
  let base = '/'
  if (typeof document !== 'undefined') {
    const baseHref = document.querySelector('base')?.getAttribute('href')
    if (baseHref) base = new URL(baseHref, window.location.origin).pathname
  }
  if (base === '/') base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}
const HEIGHT_KEY = `carbide2:agent-composer-height:${workspaceScope()}`

function loadHeight() {
  try {
    const raw = localStorage.getItem(HEIGHT_KEY)
    if (raw == null) return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return null
    // Clamp on load: a value saved in a much larger window shouldn't open
    // the composer at a ridiculous height. Drag re-clamps to the live pane.
    return Math.min(600, Math.max(MIN_BAR_HEIGHT, n))
  } catch { return null }
}
const barHeight = ref(loadHeight())

function persistHeight(v) {
  try { localStorage.setItem(HEIGHT_KEY, String(v)) } catch {}
}

function clampHeight(h) {
  const pane = barEl.value?.parentElement
  const maxH = pane ? Math.floor(pane.clientHeight * MAX_BAR_FRACTION) : 600
  return Math.min(maxH, Math.max(MIN_BAR_HEIGHT, Math.round(h)))
}

function autoGrow() {
  if (barHeight.value) return   // manual mode: flex fills the fixed bar
  const el = inputEl.value
  if (!el) return
  if (fieldSizing) {
    // Native sizing handles growth; only keep the cap current. No
    // scrollHeight/height reads in the per-keystroke path.
    updateAutoMaxHeight()
    return
  }
  // Fallback (no field-sizing): measure and set an explicit height.
  el.style.height = 'auto'
  const m = lineMetrics()
  if (!m) return
  const oneLine = m.lineH + m.pad
  const maxH = m.lineH * MAX_AUTO_LINES + m.pad
  // Before the first layout (or with web fonts still loading) scrollHeight
  // can read 0 even for a non-empty/one-line textarea — don't collapse the
  // box to 0px on that transient read; floor at one line.
  const measured = el.scrollHeight
  const target = measured > 0 ? Math.min(measured, maxH) : oneLine
  el.style.height = `${Math.max(oneLine, target)}px`
  autoMaxHeight.value = maxH
}

// Keep the caret in view while typing (sliding window). Only auto-scroll when
// typing at the end; if the user moved the caret up to edit earlier text,
// leave their position alone.
function followCaret() {
  const el = inputEl.value
  if (!el) return
  if (el.selectionStart === draft.value.length) el.scrollTop = el.scrollHeight
}

function onInputResize() {
  if (barHeight.value) {
    if (inputEl.value) inputEl.value.style.height = ''
  } else {
    autoGrow()
  }
  followCaret()
}

let resizeState = null
function onResizeStart(e) {
  const el = barEl.value
  if (!el) return
  resizeState = { startY: e.clientY, startH: el.offsetHeight }
  if (inputEl.value) inputEl.value.style.height = ''
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}
function onResizeMove(e) {
  if (!resizeState) return
  barHeight.value = clampHeight(resizeState.startH + (resizeState.startY - e.clientY))
}
function onResizeEnd() {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  resizeState = null
  if (barHeight.value) persistHeight(barHeight.value)
}

// ── Image attachments ─────────────────────────────────────────────
// Queued for the next send; cleared after onSend fires.
const MAX_IMAGES        = 6
const MAX_BYTES_PER_IMG = 8 * 1024 * 1024   // 8 MB raw
const pendingImages     = ref([])
const dragOver          = ref(false)

function formatBytes(n) {
  if (n == null) return ''
  if (n < 1024)        return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.onload  = () => {
      const s = String(r.result || '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    r.readAsDataURL(file)
  })
}

async function addFiles(files) {
  for (const file of files) {
    if (!file || !file.type || !file.type.startsWith('image/')) continue
    if (pendingImages.value.length >= MAX_IMAGES) break
    if (file.size > MAX_BYTES_PER_IMG) {
      console.warn(`[Composer] image too large, skipped: ${file.name} (${file.size} bytes)`)
      continue
    }
    try {
      const base64 = await fileToBase64(file)
      pendingImages.value.push({ mime: file.type, base64, bytes: file.size })
    } catch (e) {
      console.warn('[Composer] failed to read image', e)
    }
  }
}

function removePending(idx) {
  pendingImages.value.splice(idx, 1)
}

function onFileInput(ev) {
  const files = Array.from(ev.target.files || [])
  addFiles(files)
  ev.target.value = ''   // allow re-selecting same file
}

function onPaste(ev) {
  const items = Array.from(ev.clipboardData?.items || [])
  const files = items
    .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
    .map(it => it.getAsFile())
    .filter(Boolean)
  if (files.length) {
    ev.preventDefault()
    addFiles(files)
  }
}

function onDrop(ev) {
  dragOver.value = false
  const files = Array.from(ev.dataTransfer?.files || [])
  if (files.length) addFiles(files)
}

const activeAgentName = computed(() => {
  const a = (store.agentList || []).find(x => x.slug === props.agentSlug)
  return a?.name || 'agent'
})

const canSend = computed(() =>
  props.connected && !!props.agentSlug && props.agentStatus !== 'thinking'
)
const placeholder = computed(() => {
  if (!props.connected) return 'Disconnected.'
  if (!props.agentSlug) return 'Pick an agent above.'
  if (props.agentStatus === 'thinking') return 'Waiting for agent…'
  return `Ask ${activeAgentName.value}…`
})

function onSend() {
  const text   = draft.value.trim()
  const images = pendingImages.value.slice()
  if (!canSend.value) return
  if (!text && !images.length) return
  emit('send', text, images.length ? images : null)
  draft.value = ''
  pendingImages.value = []
  // Clicking Send moves focus to the button; pull it back so the user can
  // keep typing while the agent works. Re-fit the box in case a multi-line
  // draft collapsed back to a single line.
  nextTick(() => {
    inputEl.value?.focus()
    autoGrow()
  })
}

onMounted(() => {
  // Set the initial 1-line height (a textarea without rows defaults taller).
  // Defer one frame so the element has real layout, then re-run once web fonts
  // resolve (line-height can change after the font swaps in).
  requestAnimationFrame(() => {
    autoGrow()
    if (document.fonts?.ready) document.fonts.ready.then(() => autoGrow())
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
})
</script>

<style scoped>
.field-sizing-content {
  field-sizing: content;
}
</style>
