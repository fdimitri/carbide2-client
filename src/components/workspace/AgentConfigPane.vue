<!-- AgentConfigPane — edit the workspace's LLM agents as a pane tab.
     Agents are workspace-global (shared across projects); this pane lists
     them and lets an admin edit connection, identity, tools, and sampling
     at runtime. No project scope. -->
<template>
  <div class="flex flex-col h-full overflow-y-auto bg-bg-1/85 text-text">
    <div class="max-w-2xl w-full mx-auto px-8 py-8">

      <h2 class="text-base font-bold text-text mb-1 tracking-tight">Agent Configuration</h2>
      <p class="text-muted text-ui-md mb-6">
        Workspace-global LLM personas. Changes take effect on the next agent
        request — no redeploy needed.
      </p>

      <div v-if="loading" class="text-muted text-sm">Loading…</div>
      <div v-else-if="loadError" class="text-warn text-sm">{{ loadError }}</div>

      <template v-else>
        <!-- ── Agent selector ───────────────────────────────────────────── -->
        <div class="flex flex-wrap gap-2 mb-6">
          <button
            v-for="a in agents"
            :key="a.id"
            class="px-3 py-1.5 rounded-lg border text-ui-md cursor-pointer transition-colors"
            :class="a.id === selectedId && !isNew
              ? 'border-accent bg-sel text-accent-fg'
              : 'border-line bg-bg-2/60 text-muted hover:border-accent-bright hover:text-text'"
            @click="select(a.id)"
          >
            {{ a.name }}
            <span v-if="!a.enabled" class="text-dim">(disabled)</span>
          </button>
          <button
            class="px-3 py-1.5 rounded-lg border border-dashed text-ui-md cursor-pointer transition-colors"
            :class="isNew
              ? 'border-accent bg-sel text-accent-fg'
              : 'border-line bg-transparent text-muted hover:border-accent-bright hover:text-text'"
            @click="newAgent"
          >+ New</button>
        </div>

        <template v-if="form">
          <!-- ── Identity ───────────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Identity</h3>

            <div class="flex gap-4">
              <div class="flex-1">
                <UiField label="Name" label-class="block text-ui-md text-text mb-1" compact>
                  <UiInput v-model="form.name" class="w-full" />
                </UiField>
              </div>
              <div class="w-40">
                <UiField label="Role" label-class="block text-ui-md text-text mb-1" compact>
                  <UiInput as="select" v-model="form.role" class="w-full">
                    <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
                  </UiInput>
                </UiField>
              </div>
            </div>

            <UiField v-if="isNew" label="Slug" class="mt-3" label-class="block text-ui-md text-text mb-1" compact
                     hint="Immutable after creation. Lowercase alphanumeric with - or _.">
              <UiInput
                v-model="form.slug"
                mono
                class="w-full"
                placeholder="lowercase-id (e.g. coder-deepseek)"
              />
            </UiField>
            <div v-else class="mt-1">
              <span class="text-ui-xs text-dim font-mono">slug: {{ selectedAgent?.slug }}</span>
            </div>

            <UiField label="Description" class="mt-3" label-class="block text-ui-md text-text mb-1" compact>
              <UiInput
                v-model="form.description"
                class="w-full"
                placeholder="Short description"
              />
            </UiField>
          </section>

          <!-- ── Connection ─────────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Connection</h3>

            <UiField label="Provider URL" label-class="block text-ui-md text-text mb-1" compact>
              <UiInput
                v-model="form.provider_url"
                mono
                class="w-full"
                placeholder="http://host.k3d.internal:11234/v1"
              />
            </UiField>
            <p class="text-ui-xs text-muted mt-1">
              OpenAI-compatible base URL. The worker appends
              <code class="font-mono text-accent">/chat/completions</code>.
            </p>

            <UiField label="Model" class="mt-3" label-class="block text-ui-md text-text mb-1" compact>
              <UiInput
                v-model="form.model"
                mono
                class="w-full"
              />
            </UiField>

            <UiField class="mt-3" label="API key" label-class="block text-ui-md text-text mb-1" compact>
              <template #label-extra>
                <span class="text-dim"> ({{ selectedAgent?.api_key_set ? 'set' : 'none' }})</span>
              </template>
              <UiInput
                v-model="form.api_key"
                type="password"
                autocomplete="off"
                mono
                class="w-full"
                :placeholder="selectedAgent?.api_key_set ? '•••••• (leave blank to keep)' : 'Leave blank for local servers'"
              />
            </UiField>
          </section>

          <!-- ── System prompt ──────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">System Prompt</h3>
            <UiInput
              as="textarea"
              v-model="form.system_prompt"
              rows="6"
              mono
              text="text-ui-md leading-relaxed"
              class="w-full"
            />
          </section>

          <!-- ── Tools ──────────────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Tools</h3>
            <div class="flex flex-col gap-2">
              <label
                v-for="t in toolOptions"
                :key="t.slug"
                class="flex items-center gap-2 text-ui-md text-text cursor-pointer select-none w-fit"
                :title="t.description"
              >
                <UiCheckbox :value="t.slug" v-model="form.allowed_tools" />
                <code class="font-mono">{{ t.slug }}</code>
              </label>
            </div>

            <label class="flex items-center gap-2 text-ui-md text-text cursor-pointer select-none w-fit mt-3">
              <UiCheckbox v-model="form.shell_exec_enabled" tone="warn" />
              <span>Allow <code class="font-mono text-warn">shell_exec</code> capability</span>
            </label>
            <p class="text-ui-xs text-muted mt-1">
              Two-layer gate: shell_exec runs only when this is on
              <em>and</em> <code class="font-mono">shell_exec</code> is in the tool list above,
              and only in terminals the user marked agent-accessible.
            </p>
          </section>

          <!-- ── Sampling ───────────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Sampling</h3>
            <div class="flex gap-4">
              <div class="flex-1">
                <UiField label="Temperature" label-class="block text-ui-md text-text mb-1" compact>
                  <UiInput
                    v-model.number="form.temperature"
                    type="number" min="0" max="2" step="0.05"
                    class="w-full"
                  />
                </UiField>
              </div>
              <div class="flex-1">
                <UiField label="Max tokens" label-class="block text-ui-md text-text mb-1" compact>
                  <UiInput
                    v-model.number="form.max_tokens"
                    type="number" min="1" step="1"
                    class="w-full"
                  />
                </UiField>
              </div>
            </div>
            <UiField
              label="Reasoning effort"
              class="mt-3"
              label-class="block text-ui-md text-text mb-1"
              compact
              hint="Provider-dependent. Leave unset for the model default (DeepSeek defaults to high). Sent as the reasoning_effort request field."
            >
              <UiInput as="select" v-model="form.reasoning_effort" class="w-full">
                <option value="">unset (provider default)</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </UiInput>
            </UiField>
          </section>
          <!-- ── Orchestration ────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Orchestration</h3>
            <UiField label="Max turns" label-class="block text-ui-md text-text mb-1" compact>
              <UiInput
                v-model.number="form.max_turns"
                type="number" min="1" max="100" step="1"
                class="w-40"
                placeholder="default"
              />
            </UiField>
            <p class="text-ui-xs text-muted mt-1">
              Tool-call loop budget per message. Not sent to the model — leave blank to use the server default.
            </p>
          </section>
          <!-- ── Status + actions ───────────────────────────────────────── -->
          <section class="mb-7">
            <label class="flex items-center gap-2 text-ui-md text-text cursor-pointer select-none w-fit">
              <UiCheckbox v-model="form.enabled" />
              Enabled (selectable in the agent picker)
            </label>
          </section>

          <div class="flex items-center gap-3">
            <UiButton
              :disabled="saving || deleting"
              variant="primary"
              size="md"
              @click="save"
            >{{ saving ? (isNew ? 'Creating…' : 'Saving…') : (isNew ? 'Create' : 'Save') }}</UiButton>

            <UiButton
              v-if="!isNew"
              :disabled="saving || deleting"
              variant="ghost"
              size="md"
              @click="cloneAgent"
            >Clone</UiButton>

            <UiButton
              :disabled="saving || deleting"
              variant="warn"
              size="md"
              @click="remove"
            >{{ isNew ? 'Cancel' : (deleting ? 'Deleting…' : 'Delete') }}</UiButton>

            <span v-if="savedOk" class="text-accent text-sm">Saved.</span>
            <span v-if="saveError" class="text-warn text-sm">{{ saveError }}</span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { listAgents, updateAgent, createAgent, deleteAgent } from '../../services/agentService'
import workerSocket from '../../services/workerSocket'
import UiInput from '../ui/UiInput.vue'
import UiCheckbox from '../ui/UiCheckbox.vue'
import UiField from '../ui/UiField.vue'
import UiButton from '../ui/UiButton.vue'

// Mirrors Agent::ROLES (server).
const ROLES = ['general', 'coder', 'reviewer', 'safety', 'router']

// The tool allowlist is discovered live from the worker (agent/tools); this
// static list is only a fallback for a worker that doesn't answer. See #73.
const FALLBACK_TOOL_SLUGS = ['read_file', 'list_dir', 'list_terminals', 'shell_exec', 'file_edit_anchored', 'file_write_lines', 'file_pcre_search']

// [{ slug, name, description }] from the worker, or null until it answers.
const toolCatalog = ref(null)
const toolOptions = computed(() => {
  const cat = toolCatalog.value
  if (cat && cat.length) return cat
  return FALLBACK_TOOL_SLUGS.map((s) => ({ slug: s, name: s, description: '' }))
})

const loading   = ref(true)
const loadError = ref('')
const saving    = ref(false)
const deleting  = ref(false)
const savedOk   = ref(false)
const saveError = ref('')

const agents     = ref([])
const selectedId = ref(null)
const isNew      = ref(false)   // true while editing a not-yet-saved agent
const form       = ref(null)

const selectedAgent = computed(() =>
  agents.value.find((a) => a.id === selectedId.value) || null)

function loadForm(agent) {
  const s = agent.sampling || {}
  form.value = {
    slug:               agent.slug ?? '',
    name:               agent.name ?? '',
    description:        agent.description ?? '',
    role:               agent.role ?? 'general',
    provider_url:       agent.provider_url ?? '',
    model:              agent.model ?? '',
    api_key:            '',
    system_prompt:      agent.system_prompt ?? '',
    allowed_tools:      Array.isArray(agent.allowed_tools) ? [...agent.allowed_tools] : [],
    shell_exec_enabled: !!agent.shell_exec_enabled,
    enabled:            agent.enabled ?? true,
    temperature:        s.temperature ?? 0.2,
    max_tokens:         s.max_tokens ?? 2048,
    reasoning_effort:   s.reasoning_effort ?? '',
    max_turns:          agent.max_turns ?? null,
  }
  savedOk.value   = false
  saveError.value = ''
}

function select(id) {
  isNew.value      = false
  selectedId.value = id
  const a = agents.value.find((x) => x.id === id)
  if (a) loadForm(a)
}

// Derive a slug that doesn't collide with an existing agent.
function uniqueSlug(base) {
  const clean = String(base).toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
  const taken = new Set(agents.value.map((a) => a.slug))
  if (!taken.has(clean)) return clean
  let n = 2
  while (taken.has(`${clean}-${n}`)) n++
  return `${clean}-${n}`
}

// Start a blank new agent. selectedId is cleared so nothing in the list is
// highlighted; the form shows an editable slug field.
function newAgent() {
  isNew.value      = true
  selectedId.value = null
  loadForm({ role: 'general', enabled: true, sampling: { temperature: 0.2, max_tokens: 2048 } })
  form.value.slug = uniqueSlug('agent')
}

// Copy the currently-shown values into a fresh unsaved agent. The API key is
// never returned by the server, so a clone always starts with an empty key.
function cloneAgent() {
  if (!form.value) return
  const src = { ...form.value }
  isNew.value      = true
  selectedId.value = null
  form.value = {
    ...src,
    slug:    uniqueSlug(`${src.slug || 'agent'}-copy`),
    name:    `${src.name || 'Agent'} (copy)`,
    api_key: '',
  }
  savedOk.value   = false
  saveError.value = ''
}

async function remove() {
  // Cancelling an unsaved new agent just returns to the first existing one.
  if (isNew.value) {
    if (agents.value.length) select(agents.value[0].id)
    else { form.value = null; selectedId.value = null; isNew.value = false }
    return
  }
  const target = selectedAgent.value
  if (!target) return
  if (!window.confirm(`Delete agent "${target.name}"? This cannot be undone.`)) return
  deleting.value  = true
  saveError.value = ''
  try {
    await deleteAgent(target.id)
    agents.value = agents.value.filter((a) => a.id !== target.id)
    if (agents.value.length) select(agents.value[0].id)
    else { form.value = null; selectedId.value = null }
  } catch (e) {
    saveError.value = e.response?.data?.error || ('Failed to delete: ' + (e.message || e))
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  loadToolCatalog()
  try {
    agents.value = await listAgents()
    if (agents.value.length) select(agents.value[0].id)
  } catch (e) {
    loadError.value = 'Failed to load agents: ' + (e.message || e)
  } finally {
    loading.value = false
  }
})

onUnmounted(stopToolCatalog)

// Ask the worker which tools it can expose. If it doesn't answer we leave
// toolCatalog null so toolOptions uses the static fallback — an older worker
// replies system/error "unknown agent cmd: tools", a missing one is covered by
// the timeout. See #73.
let _offTools = null
let _offToolsErr = null
let _toolsTimer = null

function stopToolCatalog() {
  if (_offTools) { _offTools(); _offTools = null }
  if (_offToolsErr) { _offToolsErr(); _offToolsErr = null }
  if (_toolsTimer) { clearTimeout(_toolsTimer); _toolsTimer = null }
}

function loadToolCatalog() {
  _offTools = workerSocket.on('agent', 'tools', (payload) => {
    if (Array.isArray(payload?.tools)) toolCatalog.value = payload.tools
    stopToolCatalog()
  })
  _offToolsErr = workerSocket.on('system', 'error', (payload) => {
    if (typeof payload?.message === 'string' && payload.message.includes('unknown agent cmd: tools')) {
      stopToolCatalog()
    }
  })
  _toolsTimer = setTimeout(stopToolCatalog, 4000)
  workerSocket.send('agent', 'tools', {})
}

async function save() {
  if (!form.value) return
  saving.value    = true
  savedOk.value   = false
  saveError.value = ''
  try {
    const payload = {
      name:               form.value.name,
      description:        form.value.description,
      role:               form.value.role,
      provider_url:       form.value.provider_url,
      model:              form.value.model,
      system_prompt:      form.value.system_prompt,
      allowed_tools:      form.value.allowed_tools,
      shell_exec_enabled: form.value.shell_exec_enabled,
      enabled:            form.value.enabled,
      max_turns:          form.value.max_turns === '' || form.value.max_turns == null
                            ? null : Number(form.value.max_turns),
      sampling:           {
        temperature: form.value.temperature,
        max_tokens:  form.value.max_tokens,
        ...(form.value.reasoning_effort
          ? { reasoning_effort: form.value.reasoning_effort }
          : {}),
      },
    }
    // Only send api_key when the admin typed one (blank preserves the stored key).
    if (form.value.api_key) payload.api_key = form.value.api_key

    let result
    if (isNew.value) {
      payload.slug = (form.value.slug || '').trim()
      result = await createAgent(payload)
      agents.value.push(result)
      isNew.value      = false
      selectedId.value = result.id
    } else {
      if (!selectedAgent.value) return
      result = await updateAgent(selectedAgent.value.id, payload)
      const idx = agents.value.findIndex((a) => a.id === result.id)
      if (idx !== -1) agents.value[idx] = result
    }
    loadForm(result)
    savedOk.value = true
  } catch (e) {
    saveError.value = e.response?.data?.error || ('Failed to save: ' + (e.message || e))
  } finally {
    saving.value = false
  }
}
</script>
