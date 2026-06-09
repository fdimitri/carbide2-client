# carbide2-client — Architecture & Codebase Reference

Vue 3 + Vite frontend for the Carbide2 IDE. Shared cross-cutting state lives in a Pinia
store (`workspaceStore`). Per-session composables are instantiated once in `ProjectPage.vue`;
per-pane display state is read directly from the store by `WorkspacePaneShell`.

---

## Styling strategy options (decision: Hybrid)

Constraint from product direction: avoid arbitrary class values like
`py-[0.33rem]`, `right-[0.50rem]`, and similar one-off bracket values. Use a
fixed scale/tokens or reusable classes.

Selected direction:
- Use Hybrid styling (Tailwind layout/composition + semantic CSS classes for repeated UI objects).
- Keep existing Tailwind tokens, but stop introducing arbitrary unit values in class strings.
- Extract repeated controls into reusable components/classes before introducing new one-off class strings.

### Common "before" example

```vue
<button
  class="px-[0.85rem] py-[0.42rem] bg-sel border border-accent text-accent-fg rounded-ui-md"
>
  Create
</button>
```

### Option A: Tailwind-first + Vue components

Use scale classes in a component and reuse the component.

```vue
<!-- components/ui/UiButton.vue -->
<button class="px-3.5 py-2 rounded-ui-md border border-accent bg-sel text-accent-fg">
  <slot />
</button>

<!-- usage -->
<UiButton>Create</UiButton>
```

Pros:
- Fast iteration in templates.
- Reuse enforced by component API.

Cons:
- Utility-heavy templates can be noisy.
- Style intent can feel implicit.

### Option B: Hybrid (Tailwind layout + semantic CSS classes)

Keep utility classes for layout; move repeated control styles into semantic classes.

```vue
<button class="btn btn-primary">Create</button>
```

```css
/* in component scoped style or shared stylesheet */
.btn {
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.5rem 0.875rem; /* fixed scale choice */
}

.btn-primary {
  background: var(--sel);
  color: var(--accent-fg);
  border-color: var(--accent);
}
```

Pros:
- Better readability for repeated UI objects.
- Keeps Tailwind where it is strongest (layout/composition).

Cons:
- Two styling systems to govern.
- Needs clear class naming standards.

### Option C: CSS-first (minimal Tailwind)

Use semantic/component CSS as the default, Tailwind only as helper utilities.

```vue
<button class="create-action">Create</button>
```

```css
.create-action {
  padding: var(--space-2) var(--space-3_5);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--sel);
  color: var(--accent-fg);
}
```

Pros:
- Strong semantic markup.
- Easy to enforce design language centrally.

Cons:
- Larger migration cost from current code.
- More CSS authoring overhead.

### Option D: Transition path (for enforcement)

Keep current stack but enforce anti-drift rules now, postpone framework-level decision.

```vue
<!-- temporary rule: no arbitrary values, allow only scale classes -->
<button class="px-3.5 py-2 rounded-ui-md border border-accent bg-sel text-accent-fg">
  Create
</button>
```

With CI guards (broad):

```bash
# 1) Catch arbitrary numeric-unit values (px/rem/em/%/vh/vw/...)
rg -n --glob '*.vue' "\[[^\]]*[0-9.]+(px|rem|em|vh|vw|vmin|vmax|%|ch|ex|pt|pc|cm|mm|in)\]" src/components src/pages && exit 1

# 2) Optional strict mode: catch any bracket arbitrary class value in templates
rg -n --glob '*.vue' "class=\"[^\"]*\[[^\]]+\][^\"]*\"" src/components src/pages && exit 1
```

Pros:
- Immediate quality improvement with low risk.
- Buys time for an informed Tailwind-vs-CSS decision.

Cons:
- Does not by itself solve long-term style architecture.

### Extractable component candidates (Hybrid roadmap)

- `PaneHeader`
- `DialogActions` (cancel + primary)
- `ListRow` (selectable items)
- `ComposerInput` (monaco variant)
- `StatusPill` / badges
- `EmptyStateBanner`

These are option-agnostic because they reduce duplication in either utility-first or
CSS-first styling.

Priority order for next extraction pass:
1. `DialogActions` (cancel + primary) used across Explorer/Page dialogs.
2. `ListRow` used in recordings and explorer-like rows.
3. `PaneHeader` for repeated pane heading structure.
4. `ComposerInput` (monaco variant) for chat/agent composer controls.

---

## File index

| File | Role |
|---|---|
| `services/workerSocket.js` | Singleton WebSocket to the worker process |
| `services/authService.js` | JWT auth — login, logout, token storage |
| `services/projectService.js` | REST calls to Rails API |
| `services/log.js` | Levelled, bitmask-controlled console logging |
| `stores/workspaceStore.js` | Pinia store — cross-cutting reactive state (wsConnected, chat maps, userId, activePaneIndex) |
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

## `stores/workspaceStore.js`

**Role:** Pinia store holding cross-cutting reactive state that was previously drilled as
props from `ProjectPage` through `WorkspacePaneShell`. Imported directly by any component
or composable that needs these values — no prop passing required.

**State:**

| Field | Type | Purpose |
|---|---|---|
| `wsConnected` | `ref<boolean>` | `true` once `system:connected` fires; reset to `false` on reconnect |
| `currentUserId` | `computed` | Derived from `authService.userId()` |
| `activePaneIndex` | `ref<number>` | Which pane index (0–3) is currently active. Currently also tracked in `usePanes` — these should be reconciled. |
| `chatMessagesMap` | `ref<Object>` | `{ [channelId]: Message[] }` — message history for all channels |
| `chatJoiningMap` | `ref<Object>` | `{ [channelId]: boolean }` — join-in-progress flags |
| `joinedChatChannels` | `ref<Set<number>>` | Channel IDs the client has joined |

**Usage pattern:**
```js
// In any component or composable:
const store = useWorkspaceStore()
const { wsConnected, chatMessagesMap } = storeToRefs(store)
// or read directly (non-reactive):
store.wsConnected
```

**Known issues / design notes:**
- `activePaneIndex` is declared in the store but `usePanes` still maintains its own local
  `activePaneIndex` ref that is exported and used for the active-pane highlight. These should
  be consolidated — `usePanes` should read/write the store's copy.

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
| `pendingNavigation` | `ref<{kind, id, opts}\|null>` — written by `usePanes` when a tab activation or node drop requires a resource to be loaded; `ProjectPage` watches this ref and dispatches to `selectTerminalNode`/`selectChannelNode`/`selectFileNode`. Replaces the three callback parameters that previously created a circular dependency. |

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
| `activatePaneTab(paneIndex, key)` | Sets the pane's `activeTab`, writes `pendingNavigation` so `ProjectPage` loads the resource. |
| `closePaneTab(paneIndex, key)` | Removes the tab. If it was active, activates the previous tab (or clears to `null`). |
| `onTabDragStart(fromPaneIndex, tabKey, event)` | Sets `dataTransfer` with `application/x-carbide-tab` payload. |
| `onTabDrop(toPaneIndex, event)` | Moves the tab from source pane to target pane (or just activates if same pane). Calls `activatePaneTab`. |
| `onPaneDrop(paneIndex, event)` | Handles `application/x-carbide-node` drops (from explorer tree). Writes `pendingNavigation` for the dropped resource. |

**Known issues / design notes:**
- `activatePaneTab` and `onPaneDrop` no longer call page-level functions directly; they write
  `pendingNavigation` which `ProjectPage` watches. This breaks the previous circular dependency.
- `panes` is always length 4 regardless of layout. Panes beyond the current layout count
  retain their tabs silently — switching from quad back to one doesn't lose pane 2–4 tabs.
  This is intentional persistence but undocumented.
- `activePaneIndex` is still local state in `usePanes` (not in the store). It is exported and
  passed as a prop to `WorkspacePaneShell` for the active-pane highlight class.

---

## `composables/useChat.js`

**Role:** All chat state — channel list, message history, join/leave, send. Instantiated once
in `ProjectPage.vue`. Chat maps and user identity live in `workspaceStore` and are read directly
by `WorkspacePaneShell` — they are no longer passed as props.

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
| `chatUsers` | `ref<User[]>` | User list for the **currently selected** channel only |
| `activeChannelName` | `computed` | Name of `selectedChatChannelId` channel |

**State moved to `workspaceStore`** (no longer local to `useChat`):

| Store field | Type | Purpose |
|---|---|---|
| `chatMessagesMap` | `{ [channelId]: Message[] }` | Message history, keyed by channel ID |
| `chatJoiningMap` | `{ [channelId]: boolean }` | `true` while waiting for `chat:joined` confirmation |
| `joinedChatChannels` | `Set<number>` | Set of channel IDs the client has joined |
| `currentUserId` | `computed` | Derived from `authService.userId()` |
| `wsConnected` | `boolean` | WS open state |

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
- `chatMessagesMap` is in the store and shared across all panes — correct for message storage.
  `WorkspacePaneShell` reads `store.chatMessagesMap[activeChatChannelId]` where
  `activeChatChannelId` comes from the pane's own active tab key, so display isolation works.
  The problem is writes: `chat:message` only appends if the array already exists (history
  loaded), so a channel opened in a pane whose history wasn't pre-fetched will silently drop
  incoming messages until `switchChatChannel` runs.
- Join timeout (4.5 s) is a single handle — joining a second channel before the first
  times out cancels the first channel's timeout.
- `sendChat` both HTTP-posts and sends a WS frame. The WS frame is the broadcast path
  to other users. The sender will see their own message echoed back via `chat:message`.

---

## `composables/useTerminals.js`

**Role:** Terminal list, create, connect, rename. Instantiated once in `ProjectPage.vue`.
The xterm instance has been removed from this composable — all xterm lifecycle is now owned
exclusively by `TerminalPane.vue`. This composable handles only the terminal list, create
flow (dialog → WS send → `term:created` receive), and rename.

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
| `createTerminalTimeout` | 5 s timeout handle for `term:create` → `term:created` |

**Exported functions:**

| Function | What it does |
|---|---|
| `openCreateTerminalDialog()` | Auto-names next terminal, shows dialog |
| `confirmCreateTerminal()` | Reads name from dialog, calls `openTerminal({ name })` |
| `openTerminal(options)` | Sends `term:create`. Sets a 5 s timeout that shows an error if `term:created` doesn't arrive. |
| `selectTerminalNode(tid, options)` | Sets `selectedTerminalId`, adds/activates tab via `bindTabToActivePane` |
| `renameTerminalById(tid)` | `window.prompt` for new name, sends `term:rename` |
| `renameSelectedTerminal(tid)` | Delegates to `renameTerminalById`. Used by `WorkspacePaneShell` context menu. |
| `terminalModeNoop(tid)` | Sets error message — incognito/exclusive mode not implemented |
| `registerHandlers(offHandlers, onTerminalCreated)` | Registers all WS handlers. Optional callback overrides the default `selectTerminalNode` on `term:created`. |
| `cleanup()` | Clears create timeout |
| `getXterm()` | Returns `null` — xterm removed from composable; retained for call-site compatibility |

**WS handlers registered by `registerHandlers`:**

| Frame | Handler behaviour |
|---|---|
| `system:error` | Clears create timeout, sets `error.value` |
| `term:list` | Replaces `terminalList` |
| `term:created` | Clears timeout, eagerly pushes to `terminalList`, calls `onTerminalCreated` or `selectTerminalNode` |
| `term:renamed` | Updates the terminal's name in `terminalList` |

**Known issues / design notes:**
- The composable's xterm has been removed. All `term:output`/`term:joined`/`term:resized`/`term:exit`
  handling is now exclusively in `TerminalPane.vue`. This resolves the dual-xterm problem.
- `selectedTerminalId` is still global — same per-pane isolation problem as chat.

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

All other data previously passed as props (`chatMessagesMap`, `chatJoiningMap`,
`joinedChatChannels`, `currentUserId`, `wsConnected`, `activePane`, `activeChannelName`,
`chatUsers`, `selectedTerminalId`, `selectedFileId`) is now read directly from
`useWorkspaceStore()` inside this component.

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
| `paneMessages` | `store.chatMessagesMap[activeChatChannelId]` | Messages for this pane's active channel |
| `paneJoining` | `store.chatJoiningMap[activeChatChannelId]` | Join spinner state |
| `paneCanSend` | `store.joinedChatChannels.has(cid) && store.wsConnected && !joining` | Send button enable |

**Known issues / design notes:**
- `TerminalPane` is keyed as `` `term-${paneIndex}-${activeTerminalId || 'none'}` `` so
  switching terminals forces a full remount. This is correct behaviour but means terminal
  scroll history is lost on switch unless the xterm buffers it.

---

## `pages/ProjectPage.vue`

**Role:** Root of the workspace. Owns every composable, every piece of shared state, the
explorer tree, the layout switcher, context menus, and all dialogs. All composables are
instantiated here and their results are drilled as props into `WorkspacePaneShell` instances.

**Composables instantiated:**
- `usePanes({ activePane, pendingNavigation })`
- `useTerminals({ error, bindTabToActivePane, activePane })`
- `useChat(projectId, { wsConnected, error, bindTabToActivePane, activePane })`

**Store usage:**
```js
const workspaceStore = useWorkspaceStore()
const { wsConnected, joinedChatChannels: storeJoinedChatChannels } = storeToRefs(workspaceStore)
```
`wsConnected` is now a store ref; `system:connected` sets it via the store-backed ref.

**Top-level refs (not from composables or store):**

| Ref | Purpose |
|---|---|
| `project` | Loaded project object |
| `error` | Error banner text, shared by all composables |
| `activePane` | Global active-pane kind string. **Should be per-pane.** |
| `pendingNavigation` | Written by `usePanes`; watched here to dispatch `select*` calls |
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

These wrappers are called from a `watch(pendingNavigation, ...)` inside `ProjectPage`.
`usePanes` writes to `pendingNavigation` instead of calling the wrappers directly, breaking
the previous circular dependency: `ProjectPage` → `usePanes` → callbacks → `ProjectPage`.

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
- The layout template uses `LAYOUT_CONFIGS` + a single `v-for` over rows/panes — the
  copy-pasted 6-layout block has been eliminated.
- `activePane`, `selectedTerminalId`, `selectedChatChannelId` are still global singletons.
  Activating a terminal in pane 2 sets `selectedTerminalId` globally. **These should
  live inside the `panes[i]` objects** (remaining work).
- `fileTree` is hardcoded. A live FS sync is a planned feature (inotify-backed in-database FS).

---

## Cross-cutting architectural problems (summary)

1. **`selectedTerminalId` / `selectedChatChannelId` global cursors.** These are not display
   selectors — display is driven entirely by `pane.activeTab` (the tab key encodes kind + id,
   e.g. `"terminal:5"`). They are imperative-operation cursors used as fallbacks in functions
   like `renameTerminalById(tid || selectedTerminalId)`. They affect nothing visually but are
   still global. Low priority; could be eliminated by always requiring an explicit ID at the
   call site. **Remaining work.**

2. **`activePane` global kind string.** Used to decide which tab type a new resource gets
   assigned to on the active pane. Should be derivable from the active pane's `activeTab`
   key (or replaced with an explicit pane-index argument at each call site). **Remaining work.**

3. ~~**14-prop prop-drilling.**~~ **Resolved.** `WorkspacePaneShell` now reads `chatMessagesMap`,
   `chatJoiningMap`, `joinedChatChannels`, `currentUserId`, and `wsConnected` directly from
   `useWorkspaceStore()`. The 10-prop chain from `ProjectPage` is eliminated.

4. ~~**Copy-pasted layout template.**~~ **Resolved.** The template now uses `LAYOUT_CONFIGS` +
   a `v-for` over rows and panes. One `WorkspacePaneShell` block covers all layouts.

5. ~~**Dual xterm instances.**~~ **Resolved.** The xterm, FitAddon, and ResizeObserver have been
   removed from `useTerminals`. All xterm lifecycle lives exclusively in `TerminalPane.vue`.

6. ~~**Circular dependency.**~~ **Resolved.** `usePanes` no longer receives callback functions
   from `ProjectPage`. It writes `pendingNavigation`; `ProjectPage` owns a `watch()` that
   dispatches to `selectTerminalNode` / `selectChannelNode` / `selectFileNode`.
