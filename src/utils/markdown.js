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

export function renderMarkdown(src) {
  if (src == null) return ''
  const raw = marked.parse(String(src))
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
}
