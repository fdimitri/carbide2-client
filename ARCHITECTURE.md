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

## `composables/usePanes.js`

**Role:** Multi-pane layout state, tab management, and drag-drop. Instantiated once in
`ProjectPage.vue`. Exposes refs that are passed as props to every `WorkspacePaneShell`.

**Exported constant:**
```js
PANE_COUNTS = { one: 1, 'two-horizontal': 2, 'two-vertical': 2,
                'three-horizontal-wide': 3, 'three-vertical-tall': 3, quad: 4 }
```

**Inputs (injected at construction):**

| Parameter | What it is |
|---|---|
| `activePane` | `ref<string>` — shared global active-pane kind (`'terminal'`/`'chat'`/`'file'`). **Architectural problem: should be per-pane.** |
| `selectTerminalNode(tid, opts)` | Callback into `ProjectPage` — activates a terminal in the active pane |
| `selectChannelNode(cid, opts)` | Callback into `ProjectPage` — activates a chat channel |
| `selectFileNode(fid, opts)` | Callback into `ProjectPage` — activates a file |

**Reactive state:**

| Ref | Type | Purpose |
|---|---|---|
| `paneLayout` | `ref<string>` | Current layout name, e.g. `'two-horizontal'` |
| `activePaneIndex` | `ref<number>` | Which pane index (0–3) last received a mousedown |
| `panes` | `ref<Pane[4]>` | Array of 4 pane objects: `{ tabs: Tab[], activeTab: string\|null }` |

A `Tab` is `{ key: string, kind: string, id: number|string, label: string }` where `key` is
`"kind:id"` (e.g. `"channel:3"`, `"terminal:1"`, `"file:README.md"`).

**Exported functions:**

| Function | What it does |
|---|---|
| `setPaneLayout(layout)` | Sets `paneLayout`. Clamps `activePaneIndex` to the new pane count. Does **not** redistribute tabs. |
| `parseTabKey(key)` | Splits `"kind:id"` into `{ kind, id }`. Returns `null` if malformed. |
| `bindTabToActivePane(kind, id, label)` | Adds a tab to `panes[activePaneIndex]` if not present, sets it active. |
| `bindTabToPane(paneIndex, kind, id, label)` | Same but targets a specific pane index. Also sets `activePaneIndex`. |
| `activatePaneTab(paneIndex, key)` | Sets the pane's `activeTab`, then calls the appropriate `select*` callback to load the resource. |
| `closePaneTab(paneIndex, key)` | Removes the tab. If it was active, activates the previous tab (or clears to `null`). |
| `onTabDragStart(fromPaneIndex, tabKey, event)` | Sets `dataTransfer` with `application/x-carbide-tab` payload. |
| `onTabDrop(toPaneIndex, event)` | Moves the tab from source pane to target pane (or just activates if same pane). Calls `activatePaneTab`. |
| `onPaneDrop(paneIndex, event)` | Handles `application/x-carbide-node` drops (from explorer tree). Calls `select*` callback for the dropped resource. |

**Known issues / design notes:**
- `activatePaneTab` calls `selectTerminalNode`/`selectChannelNode`/`selectFileNode` which
  are page-level wrappers that also update `selectedTerminalId`, `selectedChatChannelId`, etc.
  Those are **global singletons** — meaning activating a tab in pane 2 updates the global
  selected ID, affecting what pane 1 shows if it uses those globals. This is the root of the
  per-pane isolation problems.
- `panes` is always length 4 regardless of layout. Panes beyond the current layout count
  retain their tabs silently — switching from quad back to one doesn't lose pane 2–4 tabs.
  This is intentional persistence but undocumented.
- `onPaneDrop` calls `select*` after setting `activePaneIndex`, but the select callbacks call
  `bindTabToActivePane` which reads `activePaneIndex` — so the order matters.

---

## `composables/useChat.js`

**Role:** All chat state — channel list, message history, join/leave, send. Instantiated once
in `ProjectPage.vue`. Results passed as props to every `WorkspacePaneShell`.

**Inputs (injected at construction):**

| Parameter | What it is |
|---|---|
| `projectId` | Numeric project ID, used in all REST calls |
| `wsConnected` | `ref<boolean>` — whether the worker WS is open |
| `error` | `ref<string>` — shared error banner, written on failures |
| `bindTabToActivePane` | Function from `usePanes` — opens a channel tab |
| `activePane` | `ref<string>` — set to `'chat'` when a channel is opened. **Architectural problem: global.** |

**Reactive state:**

| Ref | Type | Purpose |
|---|---|---|
| `chatChannels` | `ref<Channel[]>` | All channels for this project |
| `selectedChatChannelId` | `ref<number\|null>` | The most recently selected channel. **Global — not per-pane.** |
| `chatMessagesMap` | `ref<{ [channelId]: Message[] }>` | Message history, keyed by channel ID |
| `chatJoiningMap` | `ref<{ [channelId]: boolean }>` | `true` while waiting for `chat:joined` confirmation |
| `chatUsers` | `ref<User[]>` | User list for the **currently selected** channel only |
| `joinedChatChannels` | `ref<Set<number>>` | Set of channel IDs the client has joined |
| `currentUserId` | `computed` | Calls `authService.userId()` |
| `activeChannelName` | `computed` | Name of `selectedChatChannelId` channel |

**Exported functions:**

| Function | What it does |
|---|---|
| `isJoinedChannel(channelId)` | Returns `joinedChatChannels.has(id)` |
| `setJoinedChannel(channelId, joined)` | Immutably updates `joinedChatChannels` |
| `switchChatChannel()` | Reads `selectedChatChannelId`, sets `activePane = 'chat'`, sends `chat:join` if not already joined, loads history via REST if not cached |
| `selectChannelNode(channelId, options)` | Sets `selectedChatChannelId`, calls `bindTabToActivePane` unless `skipPaneTab`, then `switchChatChannel()` |
| `createChannelByName(name)` | POSTs to Rails, pushes result to `chatChannels`, calls `switchChatChannel()` |
| `sendChat(channelId, text)` | Validates joined state, POSTs message via REST, then sends `chat:message` WS frame |
| `scrollChat()` | Scrolls `chatEl` to bottom (currently unused — `ChatPane.vue` auto-scrolls on message count change) |
| `joinChannelFromContext(channelId)` | Context-menu join: sets `selectedChatChannelId` and calls `switchChatChannel()` |
| `leaveChannelFromContext(channelId)` | Sends `chat:leave`, removes from `joinedChatChannels` |
| `registerHandlers(offHandlers)` | Registers all WS handlers (see below). Pushes unsubscribers into `offHandlers`. |
| `init()` | Loads `chatChannels` from REST. Creates `general` channel if none exist. Resets message map. |
| `cleanup()` | Clears the join timeout if pending. |

**WS handlers registered by `registerHandlers`:**

| Frame | Handler behaviour |
|---|---|
| `chat:message` | Appends to `chatMessagesMap[channel_id]` if the array exists (i.e. history was loaded) |
| `chat:user_join` | Appends system message; adds user to `chatUsers` if on selected channel |
| `chat:user_leave` | Appends system message; removes user from `chatUsers` if on selected channel |
| `chat:user_list` | Replaces `chatUsers` if received for the selected channel |
| `chat:joined` | Sets `joinedChatChannels`, clears join timeout |
| `chat:left` | Removes from `joinedChatChannels` |

**Known issues / design notes:**
- `selectedChatChannelId` is a single global ref. Two panes opening different channels
  overwrite each other. `chatUsers` similarly reflects only the last selected channel.
- `chatMessagesMap` is shared across all panes — correct for message storage, but
  `WorkspacePaneShell` reads `chatMessagesMap[activeChatChannelId]` where
  `activeChatChannelId` comes from the pane's own active tab key, so display isolation
  actually works. The problem is writes: `chat:message` only appends if the array already
  exists (history loaded), so a channel opened in pane 2 whose history wasn't pre-fetched
  will silently drop incoming messages until the pane is clicked and `switchChatChannel` runs.
- Join timeout (4.5 s) is a single handle — joining a second channel before the first
  times out cancels the first channel's timeout.
- `sendChat` both HTTP-posts and sends a WS frame. The WS frame is the broadcast path
  to other users. The sender will see their own message echoed back via `chat:message`.

---

## `composables/useTerminals.js`

**Role:** Terminal list, create, connect, and the xterm.js instance lifecycle. Instantiated once
in `ProjectPage.vue`. There is **one xterm instance** in this composable — it is reused across
all panes. The actual per-pane xterm is now in `TerminalPane.vue` (see below); this composable
is partially superseded but still owns the terminal list, create flow, and rename.

**Inputs (injected at construction):**

| Parameter | What it is |
|---|---|
| `error` | `ref<string>` — shared error banner |
| `bindTabToActivePane` | Function from `usePanes` |
| `activePane` | `ref<string>` — set to `'terminal'` on connect. **Architectural problem: global.** |

**Reactive state:**

| Ref | Type | Purpose |
|---|---|---|
| `terminalEl` | `ref<HTMLElement\|null>` | Unused — was for the old inline xterm, now `TerminalPane` owns its own container |
| `terminalActive` | `ref<boolean>` | Whether the composable's own xterm is active (watched by `ProjectPage` to re-focus) |
| `terminalLoading` | `ref<boolean>` | True while waiting for `term:created` after `term:create` send |
| `terminalList` | `ref<Terminal[]>` | All terminals for this session |
| `selectedTerminalId` | `ref<number\|null>` | Most recently selected terminal. **Global — not per-pane.** |
| `showCreateTerminalDialog` | `ref<boolean>` | Controls the create-terminal dialog |
| `terminalCreateName` | `ref<string>` | Name field in the dialog |
| `terminalCreateOptions` | `ref<string>` | Options field (placeholder, disabled) |

**Internal non-reactive state** (module-level `let`):

| Variable | Purpose |
|---|---|
| `xterm` | The composable's own `Terminal` instance (now redundant — `TerminalPane` has its own) |
| `fitAddon` | `FitAddon` for the composable's xterm |
| `terminalId` | Which terminal ID the composable's xterm is bound to |
| `createTerminalTimeout` | 5 s timeout handle for `term:create` → `term:created` |
| `applyingRemoteResize` | Flag to suppress echo when applying a server-sent resize |

**Exported functions:**

| Function | What it does |
|---|---|
| `openCreateTerminalDialog()` | Auto-names next terminal, shows dialog |
| `confirmCreateTerminal()` | Reads name from dialog, calls `openTerminal({ name })` |
| `openTerminal(options)` | Sends `term:create`. Sets a 5 s timeout that shows an error if `term:created` doesn't arrive. |
| `selectTerminalNode(tid, options)` | Sets `selectedTerminalId`, adds/activates tab via `bindTabToActivePane`, calls `connectToTerminal` |
| `connectToTerminal(tid)` | Sets `activePane = 'terminal'`, sets `terminalId`, calls `bindTabToActivePane` |
| `renameTerminalById(tid)` | `window.prompt` for new name, sends `term:rename` |
| `renameSelectedTerminal(tid)` | Delegates to `renameTerminalById`. Used by `WorkspacePaneShell` context menu. |
| `terminalModeNoop(tid)` | Sets error message — incognito/exclusive mode not implemented |
| `registerHandlers(offHandlers, onTerminalCreated)` | Registers all WS handlers. Optional callback overrides the default `selectTerminalNode` on `term:created`. |
| `mountXterm(el)` | Creates/replaces the composable's own xterm on a DOM element. **Now only called from `ProjectPage` watcher — may be dead code since `TerminalPane` handles its own mount.** |
| `cleanup()` | Disposes xterm, clears create timeout, disconnects ResizeObserver |
| `getXterm()` | Returns the composable's xterm instance |
| `getTerminalId()` | Returns `terminalId` |

**WS handlers registered by `registerHandlers`:**

| Frame | Handler behaviour |
|---|---|
| `system:error` | Clears create timeout, sets `error.value` |
| `term:list` | Replaces `terminalList` |
| `term:created` | Clears timeout, eagerly pushes to `terminalList`, calls `onTerminalCreated` or `selectTerminalNode` |
| `term:renamed` | Updates the terminal's name in `terminalList` |
| `term:output` | Writes to composable xterm if `terminal_id` matches `terminalId` |
| `term:joined` | Applies remote resize to composable xterm, calls `fitTerminalSoon` |
| `term:resized` | Applies remote resize to composable xterm |
| `term:exit` | Writes `[session ended]` to composable xterm |

**Known issues / design notes:**
- There are now **two parallel xterm implementations**: this composable's `xterm`/`fitAddon`
  and the one inside each `TerminalPane.vue` instance. Both register `term:output` handlers.
  Output for a given `terminal_id` goes to whichever handler matches `boundTerminalId`/`terminalId`.
  In practice `TerminalPane` wins because it checks its own `boundTerminalId` while the composable
  checks `terminalId` which is only set by `connectToTerminal`. This split should be resolved by
  removing the composable's xterm entirely.
- `selectedTerminalId` is global — same per-pane isolation problem as chat.
- `terminalActive` is watched by `ProjectPage` to re-focus xterm, but `TerminalPane` handles its
  own focus via a `watch` on `props.active`. The `ProjectPage` watcher is likely dead code.

---

## `components/workspace/FilePane.vue`

**Role:** Placeholder. Displays the `fileId` prop as text. No file loading implemented yet.

**Props:** `fileId: string`

---

## `components/workspace/ChatPane.vue`

**Role:** Pure display component — message list and input. Owns its own `localInput` ref.
No WS or REST access. All data flows in via props; outgoing send flows out via emit.

**Props:**

| Prop | Type | Purpose |
|---|---|---|
| `messages` | `Message[]` | List of messages to render |
| `currentUserId` | `number\|string\|null` | Used to apply `.chat-msg--own` class |
| `joining` | `boolean` | Disables input and shows "Joining channel..." placeholder |
| `connected` | `boolean` | Disables input if WS is not connected |
| `canSend` | `boolean` | Whether the Send button is enabled (joined + connected) |

**Emits:** `send(text: string)` — fired on Enter or Send button click. Clears `localInput`.

**Internal:** `watch(messages.length)` → auto-scrolls `chatEl` to bottom on new messages.

**Known issues / design notes:**
- System messages (join/leave) from `useChat.js` have `{ system: true, text, timestamp }` but
  the template renders `msg.name` and `msg.text` unconditionally — system messages show an
  empty name span, which looks odd but doesn't break.

---

## `components/workspace/TerminalPane.vue`

**Role:** Self-contained xterm.js terminal. Manages its own xterm instance, FitAddon,
ResizeObserver, and WS subscriptions. Keyed by `term-{paneIndex}-{terminalId}` in
`WorkspacePaneShell` so it remounts when the terminal changes.

**Props:**

| Prop | Type | Purpose |
|---|---|---|
| `terminalId` | `number\|string\|null` | Which terminal to bind to. `null` shows placeholder. |
| `active` | `boolean` | Whether this pane is the active one. Used to auto-focus xterm. |

**Internal state (module-level `let`):**

| Variable | Purpose |
|---|---|
| `xterm` | `Terminal` instance, created/replaced by `ensureXterm()` |
| `fitAddon` | `FitAddon` |
| `boundTerminalId` | The terminal ID this xterm is currently subscribed to |
| `applyingRemoteResize` | Suppresses resize echo to server when applying a server-sent resize |
| `terminalResizeObserver` | `ResizeObserver` on the container div |

**Key functions:**

| Function | What it does |
|---|---|
| `ensureXterm()` | Creates xterm if not present or if `.xterm` child is missing. Wires `onData` → `term:input`, `onResize` → `term:resize`. Returns `false` if container not mounted. |
| `bindTerminal(terminalId)` | Sets `boundTerminalId`, calls `ensureXterm()`, resets xterm, sends `term:join` |
| `fitTerminalSoon()` | Double-rAF fit — needed because the container may not be final size on first frame |

**WS handlers** (registered in `<script setup>`, unregistered in `onBeforeUnmount`):

| Frame | Condition | Behaviour |
|---|---|---|
| `term:output` | `terminal_id === boundTerminalId` | `xterm.write(data)` |
| `term:joined` | `terminal_id === boundTerminalId` | Apply remote cols/rows, `fitTerminalSoon`, focus if active |
| `term:resized` | `terminal_id === boundTerminalId` | Apply remote cols/rows |
| `term:exit` | `terminal_id === boundTerminalId` | Write `[session ended]` |

**Watchers:**
- `props.terminalId` — calls `bindTerminal` on change (immediate). If `null`, resets xterm.
- `props.active` — calls `fitTerminalSoon` + `xterm.focus()` when becoming active.

**Known issues / design notes:**
- The composable `useTerminals` also registers `term:output`/`term:joined`/`term:resized`/`term:exit`
  handlers. Both run for every frame — the composable's handler filters by its own `terminalId`
  and `TerminalPane` filters by `boundTerminalId`. They should never collide in practice but
  both consume CPU for every output frame.
- `TerminalPane` sends `term:join` on every `bindTerminal` call, including when switching back
  to an already-open terminal. The worker handles idempotent joins, so this is safe but noisy.

---

## `components/workspace/WorkspacePaneShell.vue`

**Role:** Tab bar + content switcher for one pane slot. Rendered once per pane in the layout.
Reads the pane's active tab key, derives the resource kind and ID from it, then shows the
appropriate content component. Forwards user actions upward as events to `ProjectPage`.

**Props:**

| Prop | Type | Purpose |
|---|---|---|
| `pane` | `Object` | `{ tabs: Tab[], activeTab: string\|null }` — the pane's tab state from `usePanes` |
| `paneIndex` | `number` | This pane's index (0–3) |
| `activePaneIndex` | `number` | Which pane is currently active (from `usePanes`) |
| `activePane` | `string` | Global active-pane kind — **not used for display**, passed through |
| `activeChannelName` | `string` | Name of the global selected channel — **not used for display** |
| `chatUsers` | `User[]` | Global chat user list — not currently rendered in shell, passed implicitly |
| `selectedTerminalId` | `number\|null` | Global selected terminal — **not used here**, passed through |
| `selectedFileId` | `string` | Global selected file — **not used here** |
| `chatMessagesMap` | `Object` | `{ [channelId]: Message[] }` — read to get this pane's messages |
| `chatJoiningMap` | `Object` | `{ [channelId]: boolean }` — read to get this pane's joining state |
| `joinedChatChannels` | `Set<number>` | Read to determine `paneCanSend` |
| `currentUserId` | `number\|null` | Passed to `ChatPane` |
| `wsConnected` | `boolean` | Passed to `ChatPane` for `connected` prop |

**Emits:**

| Event | Payload | Meaning |
|---|---|---|
| `activate-tab` | `(paneIndex, tabKey)` | User clicked a tab |
| `close-tab` | `(paneIndex, tabKey)` | User clicked tab × |
| `rename-terminal` | — | Rename menu action |
| `send-chat` | `(channelId, text)` | Chat send from `ChatPane` |
| `pane-drop` | `(paneIndex, event)` | Explorer node dropped onto pane body |
| `tab-drag-start` | `(paneIndex, tabKey, event)` | Tab drag started |
| `tab-drop` | `(paneIndex, event)` | Tab or node dropped onto tab bar |
| `set-active-pane` | `(paneIndex)` | Mousedown on pane shell |

**Key computed properties:**

| Computed | Derived from | Purpose |
|---|---|---|
| `effectiveActiveKey` | `pane.activeTab` or first tab | The tab key to use, falling back to first tab |
| `activeTabKind` | `effectiveActiveKey.split(':')[0]` | `'file'`, `'channel'`, or `'terminal'` |
| `activeTerminalId` | `effectiveActiveKey.split(':')[1]` | Terminal ID for `TerminalPane` |
| `activeFileId` | `effectiveActiveKey.split(':').slice(1)` | File path for `FilePane` |
| `activeChatChannelId` | `effectiveActiveKey.split(':')[1]` | Channel ID for message lookup |
| `paneMessages` | `chatMessagesMap[activeChatChannelId]` | Messages for this pane's active channel |
| `paneJoining` | `chatJoiningMap[activeChatChannelId]` | Join spinner state |
| `paneCanSend` | `joinedChatChannels.has(cid) && wsConnected && !joining` | Send button enable |

**Known issues / design notes:**
- 9 of the 14 props (`activePane`, `activeChannelName`, `chatUsers`, `selectedTerminalId`,
  `selectedFileId`, and parts of `chatMessagesMap`/`chatJoiningMap`) are global state that
  should either be per-pane or not needed here at all. They exist because `ProjectPage` had no
  other way to pass information except drilling every ref as a prop.
- The same 14 props + 11 event handlers are copy-pasted once per pane instance in every layout
  variant in `ProjectPage.vue` — 4 panes × 6 layouts = up to 24 copies.
- `TerminalPane` is keyed as `` `term-${paneIndex}-${activeTerminalId || 'none'}` `` so
  switching terminals forces a full remount. This is correct behaviour but means terminal
  scroll history is lost on switch unless the xterm buffers it.

---

## `pages/ProjectPage.vue`

**Role:** Root of the workspace. Owns every composable, every piece of shared state, the
explorer tree, the layout switcher, context menus, and all dialogs. All composables are
instantiated here and their results are drilled as props into `WorkspacePaneShell` instances.

**Composables instantiated:**
- `usePanes({ activePane, selectTerminalNode, selectChannelNode, selectFileNode })`
- `useTerminals({ error, bindTabToActivePane, activePane })`
- `useChat(projectId, { wsConnected, error, bindTabToActivePane, activePane })`

**Top-level refs (not from composables):**

| Ref | Purpose |
|---|---|
| `project` | Loaded project object |
| `error` | Error banner text, shared by all composables |
| `wsConnected` | Set `true` on `system:connected`, reset to `false` (indirectly) on reconnect |
| `activePane` | Global active-pane kind string. **Should be per-pane.** |
| `offHandlers` | Array of unsubscribe functions, called in `onBeforeUnmount` |

**Explorer tree state:**

| Ref | Purpose |
|---|---|
| `explorerSearch` | Bound to the PrimeVue Tree `filterValue` |
| `fileTree` | Raw file tree (hardcoded for now — no live FS sync yet) |
| `expandedExplorerKeys` | PrimeVue Tree expanded key map |
| `selectionKeys` | PrimeVue Tree selection key map |
| `openedFileIds` | Set of file IDs that have been opened (drives `isOpen` indicator) |
| `openedTerminalIds` | Set of terminal IDs that have been opened |
| `treeContextMenu` | Template ref to PrimeVue ContextMenu component |
| `contextMenuItems` | Items array built dynamically per node kind |

**Computed:**
- `explorerNodes` — merges `primeFileNodes`, terminal list, and channel list into the three
  PrimeVue Tree group nodes (`Files`, `Terminals`, `Channels`).
- `primeFileNodes` — recursively maps `fileTree` into PrimeVue node format.
- `menuItems` — Menubar items: Create (terminal/channel) + Layout submenu.
- `dockItems` — Dock buttons: layout toggles + New Terminal + Focus shortcuts.

**Page-level wrapper functions** (update `selectionKeys` + delegate to composables):

| Function | What it does |
|---|---|
| `selectTerminalNode(tid, options)` | Updates `selectedTerminalId`, `selectionKeys`, marks terminal open, delegates to `terminals.selectTerminalNode` |
| `selectChannelNode(channelId, options)` | Updates `selectionKeys`, delegates to `chat.selectChannelNode` |
| `selectFileNode(fileId, options)` | Updates `selectedFileId`, `selectionKeys`, marks file open, calls `bindTabToPane` or `bindTabToActivePane` |

These wrappers are injected into `usePanes` as callbacks so `usePanes` can trigger navigation
when a tab is activated or a node is dropped — creating a circular dependency:
`ProjectPage` → `usePanes` → `ProjectPage` wrappers → composables → `ProjectPage` refs.

**Explorer event handlers:**

| Handler | Trigger | What it does |
|---|---|---|
| `onExplorerNodeSelect(event)` | Tree node click | Dispatches to `selectFileNode` / `selectTerminalNode` / `selectChannelNode` |
| `onExplorerNodeDblClick(node)` | Tree node dblclick | Opens rename dialog for terminals |
| `onExplorerNodeContextMenu(event, node)` | Right-click on node label | Builds context menu and calls `treeContextMenu.show()` |
| `onExplorerNodeDragStart(event, node)` | Drag from tree | Sets `application/x-carbide-node` on dataTransfer |
| `onExplorerNodeDrop(event)` | Drop onto tree | Updates `fileTree` from the new PrimeVue node order |

**Context menu builder (`buildContextMenuItems`):**

| Node kind | Menu items |
|---|---|
| `group-terminals` | New Terminal... |
| `group-channels` | New Channel... |
| `channel` | Open / Open in Pane N, separator, Join, Leave |
| `terminal` | Open / Open in Pane N, separator, Incognito/Exclusive (noop), Rename |
| `file` | Open / Open in Pane N, separator, View Extended Attributes, Rename, Copy, Cut, Delete |

"Open in Pane N" items are generated by `buildOpenItems` — one per pane in the current layout.

**Lifecycle:**

| Hook | What it does |
|---|---|
| `onMounted` | Loads project list, calls `initChat()`, gets WS token, registers `system:connected` handler, registers terminal + chat handlers, connects WS, opens README tab |
| `onBeforeUnmount` | Removes keydown/resize listeners, calls all `offHandlers`, `cleanupChat`, `cleanupTerminals`, `workerSocket.disconnect` |

**Known issues / design notes:**
- The layout template section (lines 1–505 of the template) contains 6 `<Splitter>` variants
  with the same `WorkspacePaneShell` block copy-pasted once per pane per layout — up to 24
  instances of the same 14-prop/11-event block. Adding or removing a prop requires editing
  every instance. **This should be a `v-for` over `panes.slice(0, PANE_COUNTS[paneLayout])`
  with a computed layout grid, eliminating all repetition.**
- `activePane`, `selectedTerminalId`, `selectedChatChannelId` are global singletons shared
  across all panes. Activating a terminal in pane 2 sets `selectedTerminalId` globally,
  which means pane 1's content display depends on what pane 2 last activated. **These should
  live inside the `panes[i]` objects.**
- The circular dependency between `ProjectPage` wrappers and `usePanes` callbacks makes it
  impossible to test `usePanes` in isolation. **Fix: move the resource-selection logic fully
  into the composables; `ProjectPage` should only own UI state (dialogs, explorer selection).**
- `fileTree` is hardcoded. A live FS sync is a planned feature (inotify-backed in-database FS).

---

## Cross-cutting architectural problems (summary)

1. **Global singletons masquerading as per-pane state.** `activePane`, `selectedTerminalId`,
   `selectedChatChannelId` are single refs shared by all panes. Any action in one pane mutates
   state that all other panes read.

2. **No pane-local resource selection.** Each `panes[i]` object only holds `{ tabs, activeTab }`.
   It should also hold `{ activePaneKind, activeTerminalId, activeChannelId, activeFileId }` so
   that each pane independently tracks what it is showing.

3. **14-prop prop-drilling.** Everything flows from `ProjectPage` → `WorkspacePaneShell` as
   individual props. Adding any new piece of per-pane data requires touching every pane
   instantiation in the template. **Fix: Pinia store or `provide`/`inject` keyed by pane index.**

4. **Copy-pasted layout template.** 6 layout variants × up to 4 panes = up to 24 copies of
   the same component block. **Fix: `v-for` + CSS grid.**

5. **Dual xterm instances.** `useTerminals` and `TerminalPane` both own an xterm and both
   register WS output handlers. **Fix: remove the composable's xterm entirely; it is superseded
   by `TerminalPane`.**

6. **Circular dependency.** `usePanes` calls back into `ProjectPage` wrapper functions which
   call back into composables. **Fix: invert the dependency — composables emit events or return
   action objects that `ProjectPage` handles.**
