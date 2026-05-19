<!-- MonacoEditor.vue — thin wrapper around monaco-editor -->
<template>
  <div ref="containerEl" class="monaco-editor-container" />
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

const containerEl = ref(null)
const editor      = shallowRef(null)

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

onMounted(async () => {
  const m = await loader.init()
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
    readOnly:          true,        // read-only for now — editing comes later
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
    model.setValue(next)
    editor.value.setScrollPosition({ scrollTop: 0 })
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
</script>

<style scoped>
.monaco-editor-container {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
