// Debug Channel log store.
// In-memory ring buffer of user-action events (upload, import, terminal create,
// etc.) surfaced in the Debug pane. Not persisted; cleared on reload.
import { defineStore } from 'pinia'

const MAX_EVENTS = 500
let _seq = 0

export const useDebugLogStore = defineStore('debugLog', {
  state: () => ({
    events: [], // { id, ts, severity, source, action, detail }
  }),
  actions: {
    push({ severity = 'info', source = 'app', action = '', detail = '' } = {}) {
      this.events.push({
        id: ++_seq,
        ts: Date.now(),
        severity,
        source,
        action,
        detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
      })
      if (this.events.length > MAX_EVENTS) {
        this.events.splice(0, this.events.length - MAX_EVENTS)
      }
    },
    clear() {
      this.events = []
    },
  },
})
