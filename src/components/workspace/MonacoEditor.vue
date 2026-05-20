<!-- MonacoEditor.vue — thin wrapper around monaco-editor -->
<template>
  <div ref="containerEl" class="w-full h-full min-h-0" />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import loader from '@monaco-editor/loader'

// Point loader at the locally installed monaco-editor so it works offline
import * as monaco from 'monaco-editor'
loader.config({ monaco })

const props = defineProps({
  content: {
    type: String,
    default: '',
  },
  language: {
    type: String,
    default: 'plaintext',
  },
  path: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['change', 'cursor-change'])

const containerEl    = ref(null)
const editor         = shallowRef(null)
let   applyingRemote = false
let   monacoNs       = null   // monaco namespace for Range constructor
const peerDecorations = {}    // user_id => decoration id array

// The CSS variables Monaco injects are scoped to .monaco-editor, not :root.
// Promote the ones we need to :root so other components (e.g. ChatPane) can
// reference them and stay in sync with whatever theme is active.
const THEME_VARS = [
  '--vscode-editor-background',
  '--vscode-editor-foreground',
  '--vscode-input-background',
  '--vscode-input-foreground',
  '--vscode-input-border',
  '--vscode-focusBorder',
  '--vscode-editorGroupHeader-tabsBackground',
  '--vscode-panel-border',
  '--vscode-editorLineNumber-foreground',
  '--vscode-editor-selectionBackground',
  '--vscode-editor-inactiveSelectionBackground',
]

function propagateThemeVars() {
  const editorEl = containerEl.value?.querySelector('.monaco-editor')
  if (!editorEl) return
  const computed = getComputedStyle(editorEl)
  THEME_VARS.forEach((v) => {
    const val = computed.getPropertyValue(v).trim()
    if (val) document.documentElement.style.setProperty(v, val)
  })
}

// Inject peer cursor CSS once per page load
if (!document.getElementById('carbide-peer-cursors')) {
  const s = document.createElement('style')
  s.id = 'carbide-peer-cursors'
  s.textContent = [
    '#e06c75','#98c379','#61afef','#d19a66',
    '#c678dd','#56b6c2','#e5c07b','#abb2bf',
  ].map((c, i) => `.peer-cursor-${i}{border-left:2px solid ${c};margin-left:-1px}`).join('')
  document.head.appendChild(s)
}

onMounted(async () => {
  const m = await loader.init()
  monacoNs = m
  editor.value = m.editor.create(containerEl.value, {
    value:             props.content,
    language:          props.language,
    theme:             'vs-dark',
    automaticLayout:   true,
    fontSize:          13,
    fontFamily:        '"Cascadia Code", "Fira Code", "Consolas", monospace',
    lineNumbers:       'on',
    minimap:           { enabled: true },
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    wordWrap:          'off',
  })
  editor.value.onDidChangeModelContent((e) => {
    if (applyingRemote) return
    emit('change', e.changes)
  })
  editor.value.onDidChangeCursorPosition((e) => {
    if (applyingRemote) return
    emit('cursor-change', { line: e.position.lineNumber - 1, char: e.position.column - 1 })
  })
  // Promote theme vars after editor paints (one rAF is enough)
  requestAnimationFrame(propagateThemeVars)
  // Re-promote whenever the theme changes
  editor.value.onDidChangeConfiguration(() => requestAnimationFrame(propagateThemeVars))
})

// Replace content when the file changes without recreating the editor
watch(() => props.content, (next) => {
  if (!editor.value) return
  const model = editor.value.getModel()
  if (model) {
    applyingRemote = true
    try {
      model.setValue(next)
      editor.value.setScrollPosition({ scrollTop: 0 })
    } finally {
      applyingRemote = false
    }
  }
})

// Re-apply language when the file extension changes
watch(() => props.language, (lang) => {
  if (!editor.value) return
  const model = editor.value.getModel()
  if (model) loader.init().then(m => m.editor.setModelLanguage(model, lang))
})

onBeforeUnmount(() => {
  editor.value?.dispose()
})

// Apply a change received from another client without re-emitting it.
function applyRemoteChange(changeType, changeDataStr) {
  if (!editor.value) return
  const model = editor.value.getModel()
  if (!model) return
  applyingRemote = true
  try {
    if (changeType === 'setContents') {
      model.setValue(String(changeDataStr ?? ''))
      return
    }
    let data
    try { data = JSON.parse(changeDataStr) } catch { return }
    const startLineNumber = (data.startLine ?? 0) + 1
    const startColumn     = (data.startChar ?? 0) + 1
    if (changeType === 'insertDataSingleLine' || changeType === 'insertDataMultiLine') {
      const text = Array.isArray(data.data) ? data.data.join('\n') : String(data.data ?? '')
      editor.value.executeEdits('remote', [{ range: { startLineNumber, startColumn, endLineNumber: startLineNumber, endColumn: startColumn }, text, forceMoveMarkers: true }])
    } else if (changeType === 'deleteDataSingleLine' || changeType === 'deleteDataMultiLine') {
      const endLineNumber = (data.endLine ?? data.startLine ?? 0) + 1
      const endColumn     = (data.endChar ?? data.startChar ?? 0) + 1
      editor.value.executeEdits('remote', [{ range: { startLineNumber, startColumn, endLineNumber, endColumn }, text: '', forceMoveMarkers: true }])
    }
  } finally {
    applyingRemote = false
  }
}

function setPeerCursor(userId, name, line, char) {
  if (!editor.value || !monacoNs) return
  const colorIndex = Math.abs(userId) % 8
  const lineNumber = (line ?? 0) + 1
  const column     = (char ?? 0) + 1
  const oldIds = peerDecorations[userId] || []
  const newIds = editor.value.deltaDecorations(oldIds, [{
    range: new monacoNs.Range(lineNumber, column, lineNumber, column + 1),
    options: {
      className:    `peer-cursor-${colorIndex}`,
      hoverMessage: { value: `**${name}**` },
    },
  }])
  peerDecorations[userId] = newIds
}

function removePeerCursor(userId) {
  if (!editor.value) return
  const oldIds = peerDecorations[userId] || []
  editor.value.deltaDecorations(oldIds, [])
  delete peerDecorations[userId]
}

defineExpose({ applyRemoteChange, setPeerCursor, removePeerCursor })
</script>


