// Small wrapper around marked + DOMPurify for rendering agent / chat
// markdown safely.
//
// The model output is untrusted (it may include prompt-injection attempts
// or accidental HTML); never inject it without sanitizing first.
//
// Usage in a template:
//   <span v-html="renderMarkdown(message.text)"></span>
import { marked } from 'marked'
import DOMPurify from 'dompurify'

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
