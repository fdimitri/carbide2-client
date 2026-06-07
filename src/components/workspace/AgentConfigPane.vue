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
            :class="a.id === selectedId
              ? 'border-accent bg-sel text-accent-fg'
              : 'border-line bg-bg-2/60 text-muted hover:border-accent-bright hover:text-text'"
            @click="select(a.id)"
          >
            {{ a.name }}
            <span v-if="!a.enabled" class="text-dim">(disabled)</span>
          </button>
        </div>

        <template v-if="form">
          <!-- ── Identity ───────────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Identity</h3>

            <div class="flex gap-4">
              <div class="flex-1">
                <label class="block text-ui-md text-text mb-1">Name</label>
                <input
                  v-model="form.name"
                  class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                         focus:outline-none focus:border-accent transition-all"
                />
              </div>
              <div class="w-40">
                <label class="block text-ui-md text-text mb-1">Role</label>
                <select
                  v-model="form.role"
                  class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                         focus:outline-none focus:border-accent transition-all"
                >
                  <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
                </select>
              </div>
            </div>

            <div class="mt-1">
              <span class="text-ui-xs text-dim font-mono">slug: {{ selectedAgent?.slug }}</span>
            </div>

            <label class="block text-ui-md text-text mb-1 mt-3">Description</label>
            <input
              v-model="form.description"
              class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                     placeholder:text-dim focus:outline-none focus:border-accent transition-all"
              placeholder="Short description"
            />
          </section>

          <!-- ── Connection ─────────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Connection</h3>

            <label class="block text-ui-md text-text mb-1">Provider URL</label>
            <input
              v-model="form.provider_url"
              class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text font-mono text-sm
                     placeholder:text-dim focus:outline-none focus:border-accent transition-all"
              placeholder="http://host.k3d.internal:11234/v1"
            />
            <p class="text-ui-xs text-muted mt-1">
              OpenAI-compatible base URL. The worker appends
              <code class="font-mono text-accent">/chat/completions</code>.
            </p>

            <label class="block text-ui-md text-text mb-1 mt-3">Model</label>
            <input
              v-model="form.model"
              class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text font-mono text-sm
                     focus:outline-none focus:border-accent transition-all"
            />

            <label class="block text-ui-md text-text mb-1 mt-3">
              API key
              <span class="text-dim">({{ selectedAgent?.api_key_set ? 'set' : 'none' }})</span>
            </label>
            <input
              v-model="form.api_key"
              type="password"
              autocomplete="off"
              class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text font-mono text-sm
                     placeholder:text-dim focus:outline-none focus:border-accent transition-all"
              :placeholder="selectedAgent?.api_key_set ? '•••••• (leave blank to keep)' : 'Leave blank for local servers'"
            />
          </section>

          <!-- ── System prompt ──────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">System Prompt</h3>
            <textarea
              v-model="form.system_prompt"
              rows="6"
              class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text font-mono text-ui-md leading-relaxed
                     focus:outline-none focus:border-accent transition-all resize-y"
            ></textarea>
          </section>

          <!-- ── Tools ──────────────────────────────────────────────────── -->
          <section class="mb-7">
            <h3 class="text-ui-xs font-semibold text-muted uppercase tracking-widest mb-3">Tools</h3>
            <div class="flex flex-col gap-2">
              <label
                v-for="t in TOOL_SLUGS"
                :key="t"
                class="flex items-center gap-2 text-ui-md text-text cursor-pointer select-none w-fit"
              >
                <input type="checkbox" :value="t" v-model="form.allowed_tools" class="accent-accent" />
                <code class="font-mono">{{ t }}</code>
              </label>
            </div>

            <label class="flex items-center gap-2 text-ui-md text-text cursor-pointer select-none w-fit mt-3">
              <input type="checkbox" v-model="form.shell_exec_enabled" class="accent-warn" />
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
                <label class="block text-ui-md text-text mb-1">Temperature</label>
                <input
                  v-model.number="form.temperature"
                  type="number" min="0" max="2" step="0.05"
                  class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                         focus:outline-none focus:border-accent transition-all"
                />
              </div>
              <div class="flex-1">
                <label class="block text-ui-md text-text mb-1">Max tokens</label>
                <input
                  v-model.number="form.max_tokens"
                  type="number" min="1" step="1"
                  class="w-full px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                         focus:outline-none focus:border-accent transition-all"
                />
              </div>
            </div>
          </section>

          <!-- ── Status + actions ───────────────────────────────────────── -->
          <section class="mb-7">
            <label class="flex items-center gap-2 text-ui-md text-text cursor-pointer select-none w-fit">
              <input type="checkbox" v-model="form.enabled" class="accent-accent" />
              Enabled (selectable in the agent picker)
            </label>
          </section>

          <div class="flex items-center gap-3">
            <button
              :disabled="saving"
              class="px-5 py-2 rounded-lg bg-accent text-accent-text text-sm font-bold border-0 cursor-pointer
                     hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              @click="save"
            >{{ saving ? 'Saving…' : 'Save' }}</button>

            <span v-if="savedOk" class="text-accent text-sm">Saved.</span>
            <span v-if="saveError" class="text-warn text-sm">{{ saveError }}</span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { listAgents, updateAgent } from '../../services/agentService'

// Mirrors Agent::ROLES (server) and the worker AgentTools registry. Kept as
// plain constants — small, stable capability lists.
const ROLES = ['general', 'coder', 'reviewer', 'safety', 'router']
const TOOL_SLUGS = ['read_file', 'list_dir', 'list_terminals', 'shell_exec']

const loading   = ref(true)
const loadError = ref('')
const saving    = ref(false)
const savedOk   = ref(false)
const saveError = ref('')

const agents     = ref([])
const selectedId = ref(null)
const form       = ref(null)

const selectedAgent = computed(() =>
  agents.value.find((a) => a.id === selectedId.value) || null)

function loadForm(agent) {
  const s = agent.sampling || {}
  form.value = {
    name:               agent.name ?? '',
    description:        agent.description ?? '',
    role:               agent.role ?? 'general',
    provider_url:       agent.provider_url ?? '',
    model:              agent.model ?? '',
    api_key:            '',
    system_prompt:      agent.system_prompt ?? '',
    allowed_tools:      Array.isArray(agent.allowed_tools) ? [...agent.allowed_tools] : [],
    shell_exec_enabled: !!agent.shell_exec_enabled,
    enabled:            !!agent.enabled,
    temperature:        s.temperature ?? 0.2,
    max_tokens:         s.max_tokens ?? 2048,
  }
  savedOk.value   = false
  saveError.value = ''
}

function select(id) {
  selectedId.value = id
  const a = agents.value.find((x) => x.id === id)
  if (a) loadForm(a)
}

onMounted(async () => {
  try {
    agents.value = await listAgents()
    if (agents.value.length) select(agents.value[0].id)
  } catch (e) {
    loadError.value = 'Failed to load agents: ' + (e.message || e)
  } finally {
    loading.value = false
  }
})

async function save() {
  if (!selectedAgent.value || !form.value) return
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
      sampling:           {
        temperature: form.value.temperature,
        max_tokens:  form.value.max_tokens,
      },
    }
    // Only send api_key when the admin typed one (blank preserves the stored key).
    if (form.value.api_key) payload.api_key = form.value.api_key

    const updated = await updateAgent(selectedAgent.value.id, payload)
    const idx = agents.value.findIndex((a) => a.id === updated.id)
    if (idx !== -1) agents.value[idx] = updated
    loadForm(updated)
    savedOk.value = true
  } catch (e) {
    saveError.value = e.response?.data?.error || ('Failed to save: ' + (e.message || e))
  } finally {
    saving.value = false
  }
}
</script>
