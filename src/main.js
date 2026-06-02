// Configure Monaco web workers before anything else loads the editor.
// The .js extension is required for Vite's production build (rollup needs
// the actual entry file to bundle as a worker); the dev server tolerates
// both forms but production does not.
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json')
      return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url), { type: 'module' })
    if (label === 'css' || label === 'scss' || label === 'less')
      return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), { type: 'module' })
    if (label === 'html' || label === 'handlebars' || label === 'razor')
      return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), { type: 'module' })
    if (label === 'typescript' || label === 'javascript')
      return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url), { type: 'module' })
    return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' })
  },
}

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import 'primeicons/primeicons.css'
import './styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
	theme: {
		preset: Aura,
		options: {
			// Lock the design tokens to dark mode. The default ('system') follows
			// prefers-color-scheme, which leaks white --p-content-background into
			// components like Tree on hosts/browsers that don't report dark mode.
			// The .app-dark class is set permanently on <html> in index.html.
			darkModeSelector: '.app-dark',
		},
	},
})
app.mount('#app')
