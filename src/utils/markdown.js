// Small wrapper around marked + DOMPurify for rendering agent / chat
// markdown safely.
//
// The model output is untrusted (it may include prompt-injection attempts
// or accidental HTML); never inject it without sanitizing first.
//
// Usage in a template:
//   <span v-html="renderMarkdown(message.text)"></span>
import { marked, Marked } from 'marked'
import DOMPurify from 'dompurify'
import { DIAGRAM_LANGS } from './diagrams'

// Sensible defaults: GFM-like, treat single newlines as <br> (matches what
// users expect from chat), no auto-IDs on headings.
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
})

// Allow target=_blank on links and force noopener so models can't open a
// link that hijacks our window.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// Memoize by source string. Called inline from templates (v-html), so during
// agent streaming it would otherwise re-parse every message on every token —
// O(n²) marked+DOMPurify work that pins the CPU and churns memory. The cache is
// bounded so long sessions don't leak.
const _cache = new Map()
const _CACHE_MAX = 500

export function renderMarkdown(src) {
  if (src == null) return ''
  const key = String(src)
  const hit = _cache.get(key)
  if (hit !== undefined) return hit
  const html = DOMPurify.sanitize(marked.parse(key), { USE_PROFILES: { html: true } })
  if (_cache.size >= _CACHE_MAX) _cache.delete(_cache.keys().next().value)
  _cache.set(key, html)
  return html
}

// Split markdown into top-level blocks for progressive streaming render.
// marked's lexer is fence/table/list aware, so we never split inside a code
// block. Each completed block is parsed+sanitized once (cached above) and can
// be frozen with v-memo; only the growing final block is re-touched per token.
// While `streaming`, that final block is returned as plain text so a half-typed
// fence or bold doesn't flash broken markdown — it settles to real markdown as
// soon as the next block starts (or the turn finishes).
export function renderMarkdownBlocks(src, streaming = false) {
  if (src == null) return []
  const text = String(src)
  let tokens
  try { tokens = marked.lexer(text) }
  catch { return [{ key: 0, kind: 'html', content: renderMarkdown(text) }] }
  const blocks = tokens.filter((t) => t.raw && t.raw.trim())
  const out = []
  for (let i = 0; i < blocks.length; i++) {
    const raw = blocks[i].raw
    if (streaming && i === blocks.length - 1) out.push({ key: i, kind: 'text', content: raw })
    else out.push({ key: i, kind: 'html', content: renderMarkdown(raw) })
  }
  return out
}

// ── Documents ────────────────────────────────────────────────────────────────
// A file preview (README.md, docs) is a document, not chat: a single newline is
// a soft break, not <br>, and headings get ids so in-page #links work. Own
// Marked instance so the chat settings above are untouched. Same sanitizer;
// the file may have been written by an agent, so it is as untrusted as chat.
const docMarked = new Marked({ gfm: true, breaks: false })

function slug(text) {
  return text.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

docMarked.use({
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens)
      return `<h${depth} id="${slug(inner)}">${inner}</h${depth}>\n`
    },
    // ```mermaid / ```d2: a placeholder holding the source as a code block;
    // hydrateDiagrams (utils/diagrams) swaps in the SVG once rendered. Rendering
    // is async and needs the DOM, so it cannot happen inside this string pass.
    code({ text, lang }) {
      // `lang` is the whole info string ("d2 layout=elk"); the language is its
      // first word, as marked's own renderer reads it.
      const l = ((lang || '').match(/^\S*/)?.[0] || '').toLowerCase()
      if (!DIAGRAM_LANGS.has(l)) return false   // marked's own renderer
      return `<div class="md-diagram" data-lang="${l}"><pre><code>${escapeHtml(text)}</code></pre></div>\n`
    },
  },
})

// A file preview. `mdx`: the file is MDX, so its ESM and JSX lines are not
// prose (see stripMdx). Front matter is handled for both.
export function renderMarkdownDocument(src, { mdx = false } = {}) {
  if (src == null) return ''
  let { meta, body } = splitFrontMatter(String(src))
  if (mdx) body = stripMdx(body)
  const html = frontMatterHtml(meta) + docMarked.parse(body)
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

// ── Front matter ─────────────────────────────────────────────────────────────
// A leading ---…--- block is metadata, not prose: left in, marked makes the
// first --- a rule and the last one a setext underline of whatever key came
// before it. Only top-level scalar keys are read (title, description, status,
// date …); nested keys are dropped. No YAML parser: this is a header, not data.
function splitFrontMatter(text) {
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!m) return { meta: null, body: text }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/)
    if (!kv || !kv[2]) continue
    meta[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return { meta, body: text.slice(m[0].length) }
}

const FM_SKIP = new Set(['title', 'description'])

function frontMatterHtml(meta) {
  if (!meta) return ''
  const rest = Object.entries(meta).filter(([k]) => !FM_SKIP.has(k))
  if (!meta.title && !meta.description && !rest.length) return ''
  let out = '<header class="md-frontmatter">'
  if (meta.title) out += `<h1 id="${slug(escapeHtml(meta.title))}">${escapeHtml(meta.title)}</h1>`
  if (meta.description) out += `<p class="md-fm-desc">${escapeHtml(meta.description)}</p>`
  if (rest.length) {
    out += '<dl>' + rest.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('') + '</dl>'
  }
  return out + '</header>\n'
}

// ── MDX ──────────────────────────────────────────────────────────────────────
// MDX is not run here (it compiles to a component; executing agent-written JSX
// is a sandbox question, not a rendering one). Its non-prose is removed so the
// prose reads cleanly:
//   - ESM blocks: a paragraph starting `import`/`export`, up to the blank line
//     (MDX's own rule).
//   - Component tags on a line of their own (<AdrHeader … />, <Tabs>, </Tabs>):
//     dropped, keeping whatever they wrapped. Capitalised names only, so
//     ordinary HTML passes through to the sanitizer as before.
// Fenced code is left alone.
function stripMdx(text) {
  const out = []
  let inFence = null, inEsm = false
  for (const line of text.split('\n')) {
    const fence = line.match(/^(\s{0,3})(`{3,}|~{3,})/)
    if (fence && (!inFence || (line.trim().startsWith(inFence) && line.trim().length >= inFence.length))) {
      inFence = inFence ? null : fence[2]
      out.push(line)
      continue
    }
    if (inFence) { out.push(line); continue }
    if (inEsm) { if (line.trim() === '') { inEsm = false; out.push(line) } ; continue }
    if (/^(import|export)\s/.test(line)) { inEsm = true; continue }
    if (/^\s*<\/?[A-Z][\w.]*(\s[^>]*)?\/?>\s*$/.test(line)) continue
    out.push(line)
  }
  return out.join('\n')
}
