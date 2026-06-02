import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'
import DashboardPage from '../pages/DashboardPage.vue'
import ProjectPage from '../pages/ProjectPage.vue'
import PreferencesPage from '../pages/PreferencesPage.vue'
import AboutPage from '../pages/AboutPage.vue'
import authService from '../services/authService'

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
    next('/login')
  } else if (to.path === '/login' && isAuthenticated) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router
