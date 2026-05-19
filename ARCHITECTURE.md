# carbide2-client — Architecture & Codebase Reference

Vue 3 + Vite frontend for the Carbide2 IDE. No Pinia — all state lives in composables
instantiated once in `ProjectPage.vue` and passed down as props.

---

## File index

| File | Role |
|---|---|
| `services/workerSocket.js` | Singleton WebSocket to the worker process |
| `services/authService.js` | JWT auth — login, logout, token storage |
| `services/projectService.js` | REST calls to Rails API |
| `services/log.js` | Levelled, bitmask-controlled console logging |
| `composables/usePanes.js` | Multi-pane layout, tab management, drag-drop |
| `composables/useChat.js` | Chat channel state, join/leave, messaging |
| `composables/useTerminals.js` | Terminal list, create, xterm lifecycle |
| `components/workspace/ChatPane.vue` | Pure-display chat message list + input |
| `components/workspace/TerminalPane.vue` | Self-contained xterm.js terminal component |
| `components/workspace/FilePane.vue` | File preview placeholder |
| `components/workspace/WorkspacePaneShell.vue` | Tab bar + pane content switcher |
| `pages/ProjectPage.vue` | Root workspace page — owns all composables |

---

## `services/workerSocket.js`

**Role:** Singleton WebSocket connection to the Carbide2 worker (default `ws://host:8080`).
All real-time communication goes through this one object. Imported directly by composables
and `TerminalPane.vue`.

**Protocol:** Every message is JSON `{ cs, cmd, payload }` where `cs` is a namespace
(e.g. `"term"`, `"chat"`, `"system"`) and `cmd` is the verb (e.g. `"output"`, `"message"`).

**Class: `WorkerSocket`** (exported as a singleton `export default new WorkerSocket()`)

| Method / property | What it does |
|---|---|
| `connect(token)` | Open (or reopen) the WebSocket with a JWT query param. Resets reconnect state. |
| `disconnect()` | Close socket permanently; stops reconnect loop. |
| `send(cs, cmd, payload)` | Serialize and send a frame. If not yet connected, queues it. |
| `on(cs, cmd, fn)` | Register a handler for a specific `cs:cmd`. Returns an `off()` function. Supports `cmd = '*'` wildcard for a whole namespace. |
| `off(cs, cmd, fn)` | Deregister a handler. |
| `connected` (getter) | `true` if the underlying socket is `OPEN`. |
| `_open()` | Internal — creates the native `WebSocket`, wires all four event handlers, bumps `_generation` to allow stale-close detection. |
| `_scheduleReconnect()` | Exponential backoff (1 s base, 30 s cap, 10 attempts). |
| `_clearReconnectTimer()` | Cancel any pending reconnect timeout. |

**Key internal fields:**

| Field | Purpose |
|---|---|
| `_handlers` | `{ "cs:cmd": [fn, ...] }` — registered listeners |
| `_queue` | Messages buffered before socket is `OPEN` |
| `_generation` | Incremented on each `_open()` call so that `onclose` from an old socket doesn't trigger reconnect for the new one |
| `_stopped` | Set by `disconnect()` to suppress reconnect |

**Known issues / design notes:**
- There is only one WS connection for the whole session. This means all panes share it —
  correct, the worker is stateful per-session.
- `on()` returns the unsubscribe function but callers must store and call it in `onBeforeUnmount`.
  Several places push off-handlers into an `offHandlers` array and call them all on unmount.

---
## `services/authService.js`

**Role:** Handles login, logout, token persistence, and user identity. Exported as a singleton
object (not a class). Imported by `useChat.js` to get `currentUserId`.

**State on the singleton:**

| Field | Purpose |
|---|---|
| `api` | An `axios` instance with `baseURL` set to `http://host:3000/api` and `withCredentials: true` |
| `currentUser` | User object from the last successful login, or `null` |
| `token` | JWT string, initialised from `localStorage.getItem('auth_token')` on module load |
| `isAuthenticated` (getter) | `true` if both `token` and `currentUser` are set |

**Methods:**

| Method | What it does |
|---|---|
| `login(email, password)` | `POST /api/login`. On success sets `currentUser`, `token`, writes to `localStorage`, sets `Authorization` header on `api`. Throws plain `Error` on failure. |
| `logout()` | Clears `currentUser`, `token`, `localStorage`, and the `Authorization` header. |
| `userId()` | Decodes the JWT payload from `localStorage` and returns `payload.sub` or `payload.user`. Returns `null` if no token or decode fails. Does **not** validate expiry. |
| `checkAuth()` | Restores `token` from `localStorage` and sets the `Authorization` header. Returns `true` if a token string exists. Called automatically on module load. |

**Known issues / design notes:**
- `checkAuth()` does not hit the server — `currentUser` remains `null` after a page reload even
  with a valid token, so `isAuthenticated` is always `false` post-reload. Nothing currently reads
  `isAuthenticated`, so it is latent but harmless.
- `userId()` re-reads `localStorage` on every call rather than caching.
- The axios `baseURL` is computed from `window.location.hostname` at module load and ignores
  `VITE_API_URL`. `projectService.js` reads the env var separately, so the two can diverge.

---

## `services/log.js`

**Role:** Bitmask-controlled console logger. Zero cost when disabled — every call checks the
mask before doing anything. Enabled at runtime via the browser console.

**Bits (exported as `LOG` object):**

| Name | Bit | Value | Coverage |
|---|---|---|---|
| `ENTRY` | 0 | 1 | Function entry/exit with stack trace |
| `INFO` | 1 | 2 | General informational |
| `WARN` | 2 | 4 | Warnings / unexpected state |
| `WS` | 3 | 8 | WebSocket send/receive raw frames |
| `DRAG` | 4 | 16 | Drag-and-drop events |
| `PANE` | 5 | 32 | Pane/tab state changes |
| `TERM` | 6 | 64 | Terminal lifecycle |
| `CHAT` | 7 | 128 | Chat join/leave/message |

**Exported functions:**

| Function | Bit gate | Output |
|---|---|---|
| `logEntry(tag, fn, ...args)` | `ENTRY` | `console.groupCollapsed` + `console.trace()` |
| `logInfo(tag, ...args)` | `INFO` | `console.log` |
| `logWarn(tag, ...args)` | `WARN` | `console.warn` |
| `logWs(direction, cs, cmd, payload)` | `WS` | `console.log` with `←`/`→` arrow |
| `logDrag(tag, ...args)` | `DRAG` | `console.log` |
| `logPane(tag, ...args)` | `PANE` | `console.log` |
| `logTerm(tag, ...args)` | `TERM` | `console.log` |
| `logChat(tag, ...args)` | `CHAT` | `console.log` |
| `setLogMask(mask)` | — | Sets `_mask`, persists to `localStorage` |

**Browser console API** (exposed on `window.carbide`):

```js
window.carbide.log(255)       // enable everything
window.carbide.log(8 + 64)    // WS + TERM only
window.carbide.log(0)         // off
window.carbide.help()         // show table of bits
window.carbide.logMask()      // current mask value
```

**Mask persistence:** `localStorage.carbide_log`. The Playwright test harness sets this to
`255` via `addInitScript` so all logs are captured during test runs.

---

## `services/projectService.js`

**Role:** Thin REST client wrapping all Rails API calls. Pure functions — no state. Uses `axios`
directly (not the `authService.api` instance) with `VITE_API_URL || 'http://localhost:3000'`
as the base. Auth header is read from `localStorage` on every call via `authHeaders()`.

**Exported functions:**

| Function | Method + path | Returns |
|---|---|---|
| `listProjects()` | `GET /api/projects` | `Project[]` |
| `createProject(name, description)` | `POST /api/projects` | `Project` |
| `getWsToken(projectId)` | `POST /api/projects/:id/ws_token` | `string` (JWT for worker WS) |
| `listChatChannels(projectId)` | `GET /api/projects/:id/chat_channels` | `Channel[]` |
| `createChatChannel(projectId, name)` | `POST /api/projects/:id/chat_channels` | `Channel` |
| `listChatMessages(projectId, channelId)` | `GET /api/projects/:id/chat_channels/:cid/chat_messages` | `Message[]` |
| `createChatMessage(projectId, channelId, text)` | `POST /api/projects/:id/chat_channels/:cid/chat_messages` | `Message` |

**Known issues / design notes:**
- Uses a different axios instance than `authService.api`. The base URL may differ if
  `VITE_API_URL` is not set (see `authService.js` note above).
- No error normalisation — callers receive the raw axios error. `useChat.js` and
  `useTerminals.js` catch and assign `e.message` to `error.value`.
- `createChatMessage` persists the message to the DB **and** the caller separately sends a
  `chat:message` WS frame. The worker broadcasts that frame to other connected clients. This
  means the sender sees the message via the WS echo, not directly from the HTTP response —
  if the WS echo doesn't arrive the message appears sent but not displayed.

---
