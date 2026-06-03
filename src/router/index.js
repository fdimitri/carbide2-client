import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'
import DashboardPage from '../pages/DashboardPage.vue'
import ProjectPage from '../pages/ProjectPage.vue'
import PreferencesPage from '../pages/PreferencesPage.vue'
import AboutPage from '../pages/AboutPage.vue'
import authService from '../services/authService'
import { isWorkspaceMode } from '../services/mode'
import { listProjects } from '../services/projectService'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: LoginPage,
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: DashboardPage,
    meta: { requiresAuth: true },
  },
  {
    path: '/projects/:id',
    name: 'Project',
    component: ProjectPage,
    meta: { requiresAuth: true },
  },
  {
    path: '/preferences',
    name: 'Preferences',
    component: PreferencesPage,
    meta: { requiresAuth: true },
  },
  {
    path: '/about',
    name: 'About',
    component: AboutPage,
  },
  {
    path: '/',
    redirect: '/dashboard',
  },
]

const router = createRouter({
  // Prefer the <base href> injected by the workspace SPA controller
  // (path prefix from Traefik's X-Forwarded-Prefix, e.g. "/w/2/").
  // Fall back to Vite's BASE_URL for `npm run dev` and other modes.
  history: createWebHistory(
    (typeof document !== 'undefined'
      && document.querySelector('base')?.getAttribute('href'))
    || import.meta.env.BASE_URL
  ),
  routes,
})

router.beforeEach(async (to, from, next) => {
  const isAuthenticated = await authService.checkAuth()
  const requiresAuth = to.meta.requiresAuth

  if (requiresAuth && !isAuthenticated) {
    return next('/login')
  }
  if (to.path === '/login' && isAuthenticated) {
    return next('/dashboard')
  }

  // Model B: a workspace pod hosts exactly one project and has no in-pod
  // dashboard. Landing on /dashboard in workspace mode resolves that single
  // canonical project and drops the user straight into its IDE.
  if (isWorkspaceMode && isAuthenticated && to.name === 'Dashboard') {
    try {
      const projects = await listProjects()
      if (projects.length) {
        return next(`/projects/${projects[0].id}`)
      }
    } catch {
      // Fall through to the Dashboard view, which surfaces the load error.
    }
  }

  next()
})

export default router
