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
