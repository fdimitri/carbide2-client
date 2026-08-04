import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'
import DashboardPage from '../pages/DashboardPage.vue'
import ProjectPage from '../pages/ProjectPage.vue'
import PreferencesPage from '../pages/PreferencesPage.vue'
import AboutPage from '../pages/AboutPage.vue'
import authService from '../services/authService'
import { isWorkspaceMode } from '../services/mode'

// The home route depends on the build's runtime context (same bundle, two
// mounts — see services/mode.js):
//   - workspace mode (served under /w/<id>/): the pod hosts exactly ONE
//     canonical project, so the IDE IS the home page. No /projects/:id — the
//     workspace *is* the project and its id is always canonical, so it never
//     belongs in the URL. The mount is just /w/<id>/.
//   - control mode (dashboard at origin root): home is the workspace list.
const routes = [
  {
    path: '/login',
    name: 'Login',
    component: LoginPage,
  },
  isWorkspaceMode
    ? {
        path: '/',
        name: 'Project',
        component: ProjectPage,
        meta: { requiresAuth: true },
      }
    : {
        path: '/',
        name: 'Dashboard',
        component: DashboardPage,
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
  // Catch-all: any unmatched path (e.g. the removed legacy /projects/:id, a
  // stale bookmark, or a build-switch that landed on a route this bundle no
  // longer defines) redirects to the mount root instead of rendering an empty
  // <router-view>. Keeps the app resilient across build/route changes.
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
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
    return next('/')
  }

  next()
})

export default router
