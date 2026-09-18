// Diagram fences in a markdown document: ```mermaid and ```d2 render to SVG in
// the browser. Both engines are big (mermaid ~1.5 MB; d2 is the Go engine as
// ~8 MB of WASM in a web worker), so each is imported on the first fence of
// its kind and never at startup.
//
// Rendering is memoized by (lang, source). The preview re-renders its HTML on
// every edit, which throws the DOM away; a diagram whose source did not change
// comes back from the cache synchronously, so only edited diagrams re-run.

export const DIAGRAM_LANGS = new Set(['mermaid', 'd2'])

const done    = new Map()   // key -> { svg } | { error }
const pending = new Map()   // key -> Promise<{ svg } | { error }>
const CACHE_MAX = 200

function key(lang, src) { return `${lang}\0${src}` }

let mermaidP = null
function mermaid() {
  mermaidP ??= import('mermaid').then(({ default: m }) => {
    m.initialize({
      startOnLoad: false,
      theme: 'dark',
      // strict: labels are text, no click handlers, no HTML — the file may
      // have been written by an agent.
      securityLevel: 'strict',
      // don't paint a bomb icon into document.body on a syntax error; the
      // fence shows its source and the message instead.
      suppressErrorRendering: true,
      fontFamily: 'inherit',
    })
    return m
  })
  return mermaidP
}

let d2P = null
function d2() {
  d2P ??= import('@terrastruct/d2').then(({ D2 }) => new D2())
  return d2P
}

// Dark Mauve: d2's dark theme that reads on the editor background.
const D2_DARK_THEME = 200

let seq = 0
async function run(lang, src) {
  try {
    if (lang === 'mermaid') {
      const m = await mermaid()
      const { svg } = await m.render(`md-diagram-${++seq}`, src)
      return { svg }
    }
    if (lang === 'd2') {
      const engine = await d2()
      // scale 1: natural size (the default fits the SVG to its container,
      // which balloons a small diagram to the column width); CSS caps wide ones.
      const r = await engine.compile(src, { themeID: D2_DARK_THEME, pad: 16, scale: 1 })
      const svg = await engine.render(r.diagram, { ...r.renderOptions, noXMLTag: true })
      return { svg }
    }
    return { error: `unknown diagram language ${lang}` }
  } catch (e) {
    return { error: String(e?.message || e?.str || e || 'render failed').trim() }
  }
}

// The finished render for (lang, src), or undefined when it has not run yet.
export function cachedDiagram(lang, src) {
  return done.get(key(lang, src))
}

export function renderDiagram(lang, src) {
  const k = key(lang, src)
  if (done.has(k)) return Promise.resolve(done.get(k))
  if (pending.has(k)) return pending.get(k)
  const p = run(lang, src).then((res) => {
    pending.delete(k)
    if (done.size >= CACHE_MAX) done.delete(done.keys().next().value)
    done.set(k, res)
    return res
  })
  pending.set(k, p)
  return p
}

// Fill every `.md-diagram` placeholder under `root` (see renderMarkdownDocument)
// with its SVG: from the cache at once, else after a render. A placeholder
// keeps its <pre> source until then, and for good if the render fails.
export function hydrateDiagrams(root) {
  if (!root) return
  for (const el of root.querySelectorAll('.md-diagram:not([data-state])')) {
    const lang = el.dataset.lang
    const src  = el.querySelector('pre')?.textContent ?? ''
    const hit  = cachedDiagram(lang, src)
    if (hit) { apply(el, hit); continue }
    el.dataset.state = 'loading'
    renderDiagram(lang, src).then((res) => {
      // The document may have re-rendered meanwhile; that pass hydrates anew.
      if (el.isConnected) apply(el, res)
    })
  }
}

function apply(el, res) {
  if (res.svg) {
    el.innerHTML = res.svg
    el.dataset.state = 'done'
    return
  }
  el.dataset.state = 'error'
  const note = document.createElement('div')
  note.className = 'md-diagram-error'
  note.textContent = `${el.dataset.lang}: ${res.error}`
  el.prepend(note)
}
