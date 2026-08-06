// CARB/IDE2 first-bringup wizard.
//
// One question per card, decision tree, then a settings tree over deploy.rb's
// real option specs (fetched from `deploy.rb --schema-out`, so no knob is
// restated here), a YAML view, and a deploy that runs through this page.
// Build-free ES module — see index.html.

import { createApp, ref, computed, watch, onMounted, nextTick } from 'vue'

const api = async (path, body) => {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

// Pulls the handful of keys the wizard cares about out of a pasted cluster.yaml
// (or the JSON equivalent). Deliberately not a YAML parser: the shape is two
// levels deep and we only want five keys.
function readPasted (text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try { return flatten(JSON.parse(trimmed)) } catch { /* fall through */ }
  }
  const out = {}
  const lines = text.split('\n')
  let section = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const top = line.match(/^([\w-]+):\s*$/)
    if (top) { section = top[1]; continue }
    const kv = line.match(/^\s+([\w-]+):\s*(.*)$/)
    if (!kv || !section) continue
    let [, key, value] = kv
    if (value === '|' || value === '|-') {
      const block = []
      while (i + 1 < lines.length && /^\s{4,}/.test(lines[i + 1])) block.push(lines[++i].replace(/^\s{4}/, ''))
      value = block.join('\n')
    }
    out[`${section}.${key}`] = value.replace(/^['"]|['"]$/g, '')
  }
  return out
}

const flatten = (obj) => {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = String(v2)
  }
  return out
}

const dig = (obj, key) => key.split('.').reduce((n, s) => (n && typeof n === 'object' ? n[s] : undefined), obj)

const MARK = { ok: '✓', fine: '✓', warn: '!', bad: '✗', unknown: '?' }

// Which top-level config sections get their own branch, in the order they
// matter during a bringup. Anything ungrouped falls into 'general'.
const GROUP_ORDER = ['cluster', 'storage', 'registry', 'public', 'tls-opts', 'control', 'general']
const GROUP_LABEL = {
  cluster: 'Cluster', storage: 'Storage', registry: 'Image registry',
  public: 'Public endpoint', 'tls-opts': 'Ingress TLS', control: 'Control plane',
  general: 'Build & orchestration'
}

const App = {
  setup () {
    const step = ref(0)
    const pre = ref(null)
    const plan = ref(null)
    const schema = ref(null)
    const overrides = ref({})
    const tab = ref('settings')
    const open = ref({ cluster: true })
    const busy = ref(false)
    const toast = ref('')
    const imported = ref(false)

    const log = ref('')
    const logOffset = ref(0)
    const logBox = ref(null)
    const deploying = ref(false)
    const exitCode = ref(null)

    const a = ref({
      topology: '', role: 'init', publicHost: '', serverUrl: '',
      clusterToken: '', registry: 'none', registryHost: '', registryCa: ''
    })

    const multi = computed(() => a.value.topology === 'k3s-multi')
    const joining = computed(() => multi.value && a.value.role === 'join')

    // The decision tree. Each card declares when it applies and when it is
    // answered; skipped cards simply never appear.
    const cards = computed(() => [
      { id: 'host', when: true, ok: () => !!pre.value },
      { id: 'topology', when: true, ok: () => !!a.value.topology },
      { id: 'role', when: multi.value, ok: () => !!a.value.role },
      { id: 'public', when: !joining.value, ok: () => true },
      { id: 'serverUrl', when: multi.value, ok: () => !!a.value.serverUrl.trim() },
      { id: 'token', when: joining.value, ok: () => !!a.value.clusterToken.trim() },
      { id: 'registry', when: multi.value, ok: () => a.value.registry !== 'external' || !!a.value.registryHost.trim() },
      { id: 'review', when: true, ok: () => true }
    ].filter((c) => c.when))

    const current = computed(() => cards.value[Math.min(step.value, cards.value.length - 1)])
    const canGo = computed(() => current.value?.ok())

    // What the answers imply, expressed as deploy.rb keys, so the settings tree
    // shows the same effective values the YAML will carry.
    const wizardValues = computed(() => {
      const v = {}
      if (!a.value.topology) return v
      v['cluster.backend'] = a.value.topology.startsWith('k3d') ? 'k3d' : 'k3s'
      v['storage.backend'] = multi.value ? 'longhorn' : 'local-path'
      if (multi.value) {
        v['cluster.role'] = a.value.role
        if (a.value.serverUrl) v['cluster.server-url'] = a.value.serverUrl
        if (joining.value && a.value.clusterToken) v['cluster.token'] = a.value.clusterToken
      }
      if (a.value.publicHost) v['public.host'] = a.value.publicHost
      if (a.value.registry !== 'none') {
        if (a.value.registryHost) v['registry.host'] = a.value.registryHost
        if (a.value.registry === 'external') {
          v['registry.external'] = true
          if (a.value.registryCa) v['registry.ca'] = a.value.registryCa
        }
      }
      return v
    })

    // One control per option spec. The `--x-file` variants are dropped: they
    // set the same key as their inline twin, and a form has no use for a path
    // on the server's disk.
    const groups = computed(() => {
      if (!schema.value) return []
      const seen = new Set()
      const byGroup = {}
      for (const s of schema.value.specs) {
        if (!s.key || (s.long || '').endsWith('-file') || seen.has(s.key)) continue
        seen.add(s.key)
        const head = s.key.includes('.') ? s.key.split('.')[0] : 'general'
        const g = GROUP_LABEL[head] ? head : 'general'
        ;(byGroup[g] ||= []).push(s)
      }
      return GROUP_ORDER.filter((g) => byGroup[g]).map((g) => ({ id: g, label: GROUP_LABEL[g], specs: byGroup[g] }))
    })

    const valueOf = (key) => {
      if (key in overrides.value) return overrides.value[key]
      if (key in wizardValues.value) return wizardValues.value[key]
      const d = dig(schema.value?.defaults, key)
      return d === undefined || d === null ? '' : d
    }

    const truthy = (key) => valueOf(key) === true || valueOf(key) === 'true'
    const isBool = (spec) => !spec.arg
    // PEM bodies get pasted in whole; a single-line input for those is useless.
    const isLong = (spec) => spec.arg === 'PEM' || String(valueOf(spec.key)).includes('\n')
    const touched = (key) => key in overrides.value || key in wizardValues.value

    const setOverride = (key, value) => {
      overrides.value = { ...overrides.value, [key]: value }
      schedulePlan()
    }

    let planTimer = null
    const schedulePlan = () => {
      clearTimeout(planTimer)
      planTimer = setTimeout(refreshPlan, 250)
    }

    const next = async () => {
      if (!canGo.value) return
      if (cards.value[step.value + 1]?.id === 'review') await refreshPlan()
      step.value = Math.min(step.value + 1, cards.value.length - 1)
    }
    const back = () => { step.value = Math.max(step.value - 1, 0) }

    const pick = (field, value) => { a.value[field] = value; next() }

    const body = () => ({ answers: a.value, overrides: overrides.value })

    const refreshPlan = async () => {
      busy.value = true
      try { plan.value = await api('/api/plan', body()) } finally { busy.value = false }
    }

    const save = async () => {
      const { path } = await api('/api/write', body())
      flash(`wrote ${path}`)
    }

    const copy = async () => {
      await navigator.clipboard.writeText(plan.value.yaml)
      flash('copied to clipboard')
    }

    // The server writes cluster.yaml and regenerates the command line itself —
    // the browser only says "go".
    const deploy = async () => {
      const res = await api('/api/deploy', body())
      if (res.error) return flash(res.error)
      log.value = ''
      logOffset.value = 0
      exitCode.value = null
      deploying.value = true
      tab.value = 'log'
      poll()
    }

    // Polling, not a stream: a reload mid-deploy picks the log back up from
    // wherever it got to, which an EventSource would not.
    const poll = async () => {
      const snap = await api(`/api/deploy/log?offset=${logOffset.value}`)
      if (snap.chunk) {
        log.value += snap.chunk
        logOffset.value = snap.offset
        await nextTick()
        if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
      }
      deploying.value = snap.running
      exitCode.value = snap.exit
      if (snap.running) setTimeout(poll, 700)
    }

    const flash = (msg) => { toast.value = msg; setTimeout(() => { toast.value = '' }, 2500) }

    watch([multi, joining], () => { if (plan.value) schedulePlan() })

    // Import needs no textbox and no permission prompt: a paste anywhere on the
    // page is user-initiated, so clipboardData is readable directly. This is
    // what replaces scp'ing the frozen config between nodes.
    onMounted(async () => {
      pre.value = await api('/api/preflight')
      const nic = pre.value.interfaces?.[0]
      if (nic) a.value.serverUrl = `https://${nic.ip}:6443`
      // Optional: without it the settings tree hides and the YAML view carries on.
      try { schema.value = await api('/api/schema') } catch { schema.value = null }

      window.addEventListener('paste', (ev) => {
        const text = ev.clipboardData?.getData('text') || ''
        if (!text.includes('cluster')) return
        const got = readPasted(text)
        // Swallow the paste so a whole config dump doesn't land verbatim in
        // whatever field happens to be focused — we want the extracted keys.
        if (got['cluster.token'] || got['cluster.server-url']) ev.preventDefault()
        if (got['cluster.server-url']) a.value.serverUrl = got['cluster.server-url']
        if (got['cluster.token']) a.value.clusterToken = got['cluster.token']
        if (got['public.host']) a.value.publicHost = got['public.host']
        if (got['registry.host']) { a.value.registryHost = got['registry.host']; a.value.registry = 'external' }
        if (got['registry.ca']) a.value.registryCa = got['registry.ca']
        if (got['cluster.token']) { a.value.topology = 'k3s-multi'; a.value.role = 'join' }
        imported.value = true
        flash('imported from clipboard')
      })
    })

    const nicLabel = (n) => [
      n.vendor, n.speed ? `${n.speed >= 1000 ? n.speed / 1000 + ' Gbit' : n.speed + ' Mbit'}` : 'link speed unknown'
    ].filter(Boolean).join(' · ')

    return {
      a, pre, plan, schema, step, cards, current, canGo, busy, toast, imported,
      multi, joining, groups, valueOf, truthy, isBool, isLong, touched, setOverride,
      tab, open, log, logBox, deploying, exitCode,
      next, back, pick, save, copy, deploy, nicLabel, MARK
    }
  },

  template: `
<div class="shell">
  <div class="brand">CARB/IDE2 · first bringup</div>

  <div class="rail">
    <i v-for="(c, i) in cards" :key="c.id" :class="{ done: i < step, here: i === step }"></i>
  </div>

  <!-- host checks -->
  <div class="card" v-if="current.id === 'host'">
    <h2>This machine</h2>
    <p class="why">Advisory only — nothing here blocks a deploy.</p>
    <div v-if="!pre">checking…</div>
    <template v-else>
      <div class="checks">
        <div class="check" v-for="c in [pre.os, pre.cpu, pre.memory, pre.disk]" :key="c.label">
          <span class="mark" :class="c.status">{{ MARK[c.status] }}</span>
          <span class="k">{{ c.label }}</span>
          <span><span class="v">{{ c.value }}</span> <span class="d" v-if="c.detail">— {{ c.detail }}</span></span>
        </div>
        <div class="check" v-for="t in pre.tools" :key="t.label">
          <span class="mark" :class="t.status">{{ MARK[t.status] }}</span>
          <span class="k">{{ t.label }}</span>
          <span><span class="v">{{ t.value }}</span> <span class="d" v-if="t.detail">— {{ t.detail }}</span></span>
        </div>
      </div>
      <div class="nics" v-if="pre.interfaces.length">
        <div class="head">Network interfaces</div>
        <div class="checks">
          <div class="check" v-for="n in pre.interfaces" :key="n.name">
            <span class="mark" :class="n.status">{{ MARK[n.status] }}</span>
            <span class="k">{{ n.name }}</span>
            <span><span class="v">{{ n.ip }}</span> <span class="d">— {{ nicLabel(n) }}</span></span>
          </div>
        </div>
      </div>
      <div class="warnline" v-for="n in pre.notes" :key="n.text">! {{ n.text }}</div>
    </template>
    <div class="actions">
      <div class="spacer"></div>
      <button class="btn" :disabled="!canGo" @click="next">Start</button>
    </div>
  </div>

  <!-- topology -->
  <div class="card" v-else-if="current.id === 'topology'">
    <h2>What are you standing up?</h2>
    <p class="why">This picks the Kubernetes backend and the storage driver.</p>
    <div class="choices">
      <button class="choice" :class="{ on: a.topology === 'k3d-single' }" @click="pick('topology','k3d-single')">
        <strong>Single node — k3d</strong>
        <span>k3s inside Docker. Fastest to stand up and to throw away. Ingress on :8080/:8443.</span>
      </button>
      <button class="choice" :class="{ on: a.topology === 'k3s-single' }" @click="pick('topology','k3s-single')">
        <strong>Single node — k3s</strong>
        <span>Host-native. Binds the real :80/:443, so the box serves on its own name. Needs sudo.</span>
      </button>
      <button class="choice" :class="{ on: a.topology === 'k3s-multi' }" @click="pick('topology','k3s-multi')">
        <strong>Multi-node — k3s</strong>
        <span>Every node is a control-plane server (HA etcd). Adds Longhorn and an image registry.</span>
      </button>
    </div>
    <div class="actions"><button class="ghost btn" @click="back">Back</button></div>
  </div>

  <!-- role -->
  <div class="card" v-else-if="current.id === 'role'">
    <h2>Is this the first node?</h2>
    <p class="why">The first node mints the shared join token; the others consume it.</p>
    <div class="choices">
      <button class="choice" :class="{ on: a.role === 'init' }" @click="pick('role','init')">
        <strong>First node</strong>
        <span>Creates the cluster. You'll get a frozen config to carry to the others.</span>
      </button>
      <button class="choice" :class="{ on: a.role === 'join' }" @click="pick('role','join')">
        <strong>Joining an existing cluster</strong>
        <span>At least one node is already up and you have its config. Paste it — Ctrl+V anywhere.</span>
      </button>
    </div>
    <div class="actions"><button class="ghost btn" @click="back">Back</button></div>
  </div>

  <!-- public host -->
  <div class="card" v-else-if="current.id === 'public'">
    <h2>What's the public URL?</h2>
    <p class="why">Drives the ingress host rule, the TLS certificate SANs, and Rails host auth.</p>
    <label class="field">
      <span class="name">Public hostname</span>
      <input type="text" v-model="a.publicHost" placeholder="carbide.example.com" />
      <span class="hint">Leave blank to use this host's <code>hostname -f</code>.</span>
    </label>
    <div class="actions">
      <button class="ghost btn" @click="back">Back</button>
      <div class="spacer"></div>
      <button class="btn" @click="next">Continue</button>
    </div>
  </div>

  <!-- server url -->
  <div class="card" v-else-if="current.id === 'serverUrl'">
    <h2>{{ joining ? "Which node are you joining?" : "How do other nodes reach this one?" }}</h2>
    <p class="why">The Kubernetes API address on :6443 — a node-to-node address, not the browser one.</p>
    <div class="choices" v-if="!joining && pre && pre.interfaces.length">
      <button class="choice" v-for="n in pre.interfaces" :key="n.name"
              :class="{ on: a.serverUrl === 'https://' + n.ip + ':6443' }"
              @click="a.serverUrl = 'https://' + n.ip + ':6443'">
        <strong>{{ n.name }} — {{ n.ip }}</strong>
        <span>{{ nicLabel(n) }}</span>
      </button>
    </div>
    <label class="field" style="margin-top:1rem">
      <span class="name">Server URL</span>
      <input type="text" v-model="a.serverUrl" placeholder="https://10.0.0.5:6443" />
    </label>
    <div class="actions">
      <button class="ghost btn" @click="back">Back</button>
      <div class="spacer"></div>
      <button class="btn" :disabled="!canGo" @click="next">Continue</button>
    </div>
  </div>

  <!-- join token -->
  <div class="card" v-else-if="current.id === 'token'">
    <h2>Paste the first node's config</h2>
    <p class="why">Ctrl+V anywhere on this page, or paste into the box. This is a secret — it joins a node as a full control-plane member.</p>
    <label class="field">
      <span class="name">cluster.yaml (or just the token)</span>
      <textarea v-model="a.clusterToken" placeholder="paste cluster.frozen.yaml here"></textarea>
      <span class="hint" v-if="imported">Imported from clipboard.</span>
    </label>
    <div class="actions">
      <button class="ghost btn" @click="back">Back</button>
      <div class="spacer"></div>
      <button class="btn" :disabled="!canGo" @click="next">Continue</button>
    </div>
  </div>

  <!-- registry -->
  <div class="card" v-else-if="current.id === 'registry'">
    <h2>Where do the images come from?</h2>
    <p class="why">Multi-node needs a registry: pods get scheduled onto nodes that never ran the build.</p>
    <div class="choices">
      <button class="choice" :class="{ on: a.registry === 'local' }" @click="a.registry = 'local'">
        <strong>Stand one up here</strong>
        <span>This host builds the images and runs the registry the other nodes pull from.</span>
      </button>
      <button class="choice" :class="{ on: a.registry === 'external' }" @click="a.registry = 'external'">
        <strong>I already have a CARB/IDE2 registry</strong>
        <span>Images are already pushed. This node just pulls — no local build.</span>
      </button>
    </div>
    <template v-if="a.registry !== 'none'">
      <label class="field" style="margin-top:1.25rem">
        <span class="name">Registry host</span>
        <input type="text" v-model="a.registryHost" placeholder="build.example.com" />
        <span class="hint">Must resolve and be reachable on :5000 from every node.</span>
      </label>
      <label class="field" v-if="a.registry === 'external'">
        <span class="name">Registry CA (PEM)</span>
        <textarea v-model="a.registryCa" placeholder="-----BEGIN CERTIFICATE-----"></textarea>
        <span class="hint">Inlined into the config so joining nodes trust it with nothing to copy.</span>
      </label>
    </template>
    <div class="actions">
      <button class="ghost btn" @click="back">Back</button>
      <div class="spacer"></div>
      <button class="btn" :disabled="!canGo" @click="next">Continue</button>
    </div>
  </div>

  <!-- review -->
  <div class="card" v-else>
    <h2>Here's what we recommend</h2>
    <p class="why">Every knob deploy.rb has, pre-set from your answers. Change anything — the YAML follows.</p>

    <div class="tabs">
      <button :class="{ on: tab === 'settings' }" @click="tab = 'settings'">Settings</button>
      <button :class="{ on: tab === 'yaml' }" @click="tab = 'yaml'">YAML</button>
      <button :class="{ on: tab === 'log' }" @click="tab = 'log'" v-if="log || deploying">Deploy log</button>
    </div>

    <template v-if="tab === 'settings'">
      <p class="warnline" v-if="!schema">! Option schema unavailable — use the YAML tab.</p>
      <div class="group" v-for="g in groups" :key="g.id">
        <button class="grouphead" @click="open[g.id] = !open[g.id]">
          <span class="caret" :class="{ open: open[g.id] }">▸</span>
          <span class="label">{{ g.label }}</span>
          <span class="count">{{ g.specs.length }}</span>
        </button>
        <div class="groupbody" v-show="open[g.id]">
          <div class="knob" v-for="s in g.specs" :key="s.key">
            <div class="knobkey">
              <code :class="{ set: touched(s.key) }">{{ s.key }}</code>
              <span class="desc">{{ s.desc }}</span>
            </div>
            <div class="knobctl">
              <select v-if="s.values" :value="valueOf(s.key)" @change="setOverride(s.key, $event.target.value)">
                <option v-for="v in s.values" :key="v" :value="v">{{ v }}</option>
              </select>
              <label v-else-if="isBool(s)" class="toggle">
                <input type="checkbox" :checked="truthy(s.key)"
                       @change="setOverride(s.key, $event.target.checked)" />
                <span>{{ truthy(s.key) ? 'on' : 'off' }}</span>
              </label>
              <textarea v-else-if="isLong(s)" :value="valueOf(s.key)"
                        @change="setOverride(s.key, $event.target.value)"></textarea>
              <input v-else type="text" :value="valueOf(s.key)" :placeholder="s.arg"
                     @change="setOverride(s.key, $event.target.value)" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'yaml'">
      <pre class="out" v-if="plan">{{ plan.yaml }}</pre>
      <div v-if="plan">
        <div class="head">Equivalent commands</div>
        <pre class="out">{{ plan.commands.join('\\n') }}</pre>
      </div>
    </template>

    <template v-else>
      <pre class="out log" ref="logBox">{{ log || 'starting…' }}</pre>
      <div class="warnline" v-if="deploying">! deploy running — closing this page won't stop it.</div>
      <div class="warnline" v-else-if="exitCode">! deploy exited {{ exitCode }} — see the log above.</div>
    </template>

    <div class="actions">
      <button class="ghost btn" @click="back">Back</button>
      <div class="spacer"></div>
      <span class="toast" v-if="toast">{{ toast }}</span>
      <button class="ghost btn" @click="copy" :disabled="busy">Copy YAML</button>
      <button class="ghost btn" @click="save" :disabled="busy">Write cluster.yaml</button>
      <button class="btn" @click="deploy" :disabled="busy || deploying">{{ deploying ? 'Deploying…' : 'Deploy' }}</button>
    </div>
  </div>
</div>`
}

createApp(App).mount('#app')
