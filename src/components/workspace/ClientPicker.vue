<script setup>
import { computed, onMounted, ref } from 'vue'
import Select from 'primevue/select'
import { currentPin, listClients, switchTo } from '../../services/clientService'

// Client build picker. Lists the builds this pod can serve (grouped by family)
// and switches by full page reload — see clientService for the resolve-once
// invariant. Rendered in the workspace menubar next to the session picker.

const loading = ref(false)
const families = ref([])
const defaultFamily = ref(null)

// PrimeVue Select value is "<family>@<sha>". Options are grouped by family.
const selected = ref(currentPin())

const groups = computed(() =>
  families.value.map((f) => ({
    label: f.name,
    items: (f.builds || []).map((b) => ({
      label: buildLabel(f, b),
      value: `${f.name}@${b.sha}`,
    })),
  }))
)

// Nothing to choose between? Hide the control entirely.
const hasChoice = computed(
  () => groups.value.reduce((n, g) => n + g.items.length, 0) > 1
)

function buildLabel(family, build) {
  const base = build.label || build.sha
  const isDefault = build.sha === family.default_sha
  return isDefault ? `${base} (latest)` : base
}

async function load() {
  loading.value = true
  try {
    const data = await listClients()
    families.value = data.families || []
    defaultFamily.value = data.default || null
    // If the loader hasn't pinned anything yet, reflect the default build so
    // the control isn't blank.
    if (!selected.value) {
      const fam = families.value.find((f) => f.name === defaultFamily.value)
      if (fam && fam.default_sha) selected.value = `${fam.name}@${fam.default_sha}`
    }
  } catch {
    families.value = []
  } finally {
    loading.value = false
  }
}

function onChange(e) {
  const val = e.value
  if (!val || val === currentPin()) return
  const [family, sha] = val.split('@')
  switchTo(family, sha)
}

onMounted(load)
</script>

<template>
  <Select
    v-if="hasChoice"
    v-model="selected"
    :options="groups"
    option-group-label="label"
    option-group-children="items"
    option-label="label"
    option-value="value"
    placeholder="Client"
    size="small"
    class="client-select"
    title="Switch SPA client build (reloads)"
    @change="onChange"
    @show="load"
  />
</template>
