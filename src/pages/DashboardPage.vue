<template>
  <div class="min-h-full bg-bg-0 text-text font-ui">
    <!-- Hero strip -->
    <div class="border-b border-line/70 bg-bg-0/60 px-10 py-10">
      <div class="max-w-5xl mx-auto flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-muted text-xs font-mono uppercase tracking-[0.15em] mb-2">Workspace</p>
          <h1 class="text-text text-2xl font-bold tracking-tight">Your Projects</h1>
        </div>
        <button @click="showNewProject = !showNewProject"
          class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-accent-text text-sm font-bold
                 border-0 cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all
                 shadow-[0_4px_20px_rgba(46,196,182,0.3)]"  
        ><span class="text-base leading-none font-bold">+</span> New Project</button>
      </div>
    </div>

    <div class="max-w-5xl mx-auto px-10 py-10">

      <!-- New project inline form -->
      <div v-if="showNewProject"
        class="mb-8 p-5 rounded-xl border border-accent/25 bg-bg-1/70 backdrop-blur flex flex-wrap gap-4 items-end">
        <div class="flex flex-col gap-1.5 flex-1 min-w-[180px]">
          <label class="text-muted text-label font-semibold uppercase tracking-widest">Name</label>
          <input v-model="newName" placeholder="my-project" autofocus
            class="px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                   placeholder:text-dim focus:outline-none focus:border-accent transition-all" />
        </div>
        <div class="flex flex-col gap-1.5 flex-1 min-w-[180px]">
          <label class="text-muted text-label font-semibold uppercase tracking-widest">Description</label>
          <input v-model="newDesc" placeholder="optional"
            class="px-3 py-2 rounded-lg bg-bg-input border border-line text-text text-sm
                   placeholder:text-dim focus:outline-none focus:border-accent transition-all" />
        </div>
        <div class="flex gap-2">
          <button @click="createProject" :disabled="!newName.trim()"
            class="px-4 py-2 rounded-lg bg-accent text-accent-text text-sm font-bold border-0 cursor-pointer
                   hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            Create
          </button>
          <button @click="showNewProject = false"
            class="px-4 py-2 rounded-lg bg-transparent border border-line text-muted text-sm
                   cursor-pointer hover:border-accent hover:text-text transition-all">
            Cancel
          </button>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-20 gap-3 text-muted text-sm">
        <span class="animate-spin text-accent">◈</span> Loading projects…
      </div>

      <!-- Empty -->
      <div v-else-if="projects.length === 0" class="text-center py-24">
        <div class="text-5xl mb-4 text-bg-3">◈</div>
        <p class="text-text font-semibold mb-1">No projects yet</p>
        <p class="text-muted text-sm">Create one to get started.</p>
      </div>

      <!-- Project grid -->
      <div v-else class="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
        <div v-for="p in projects" :key="p.id"
          class="group relative rounded-xl border border-line bg-bg-1/60 p-7 cursor-pointer overflow-hidden
                 hover:border-accent/50 hover:bg-bg-2/85
                 hover:shadow-[0_8px_32px_rgba(46,196,182,0.1)]
                 transition-all duration-200"
          @click="openProject(p.id)">
          <!-- Hover accent bar -->
          <div class="absolute inset-x-0 top-0 h-[2px] bg-accent origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-200"></div>
          <h3 class="text-text font-semibold mb-1">{{ p.name }}</h3>
          <p class="text-muted text-xs mb-4 line-clamp-2 leading-relaxed">{{ p.description || 'No description' }}</p>
          <span class="text-[0.65rem] text-[#3a4d64] font-mono">{{ formatDate(p.created_at) }}</span>
        </div>
      </div>

      <p v-if="error" class="mt-6 text-warn text-sm">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listProjects, createProject as apiCreateProject } from '../services/projectService'

const router    = useRouter()
const projects  = ref([])
const loading   = ref(true)
const error     = ref('')

const showNewProject = ref(false)
const newName = ref('')
const newDesc = ref('')

onMounted(async () => {
  await loadProjects()
})

async function loadProjects() {
  loading.value = true
  error.value   = ''
  try {
    projects.value = await listProjects()
  } catch (e) {
    error.value = e.message || 'Failed to load projects'
  } finally {
    loading.value = false
  }
}

async function createProject() {
  try {
    await apiCreateProject(newName.value.trim(), newDesc.value.trim())
    newName.value = ''
    newDesc.value = ''
    showNewProject.value = false
    await loadProjects()
  } catch (e) {
    error.value = e.message || 'Failed to create project'
  }
}

function openProject(id) {
  router.push(`/projects/${id}`)
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString()
}
</script>


