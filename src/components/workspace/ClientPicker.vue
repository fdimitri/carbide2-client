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

// PrimeVue Select value. The newest build of a family uses the family name
// alone ("carbide2-client") = "track latest" (clears any pin); older builds use
// "<family>@<sha>" = pin that exact build. This mirrors what the loader honors.
const selected = ref(currentPin())

const groups = computed(() =>
  families.value.map((f) => ({
    label: f.name,
    items: (f.builds || []).map((b) => ({
      label: buildLabel(f, b),
      value: b.sha === f.default_sha ? f.name : `${f.name}@${b.sha}`,
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
    // No pin set (loader is tracking the newest)? Reflect the family-only
    // "latest" option so the control isn't blank and shows the live state.
    if (!selected.value && defaultFamily.value) {
      selected.value = defaultFamily.value
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
  switchTo(val)
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
