// Build-time app version surfaced in the UI footer/header.
//
// `__APP_VERSION__` is injected by Vite from package.json (see vite.config.js).
// Client versions may include the release codename slug directly
// (e.g. 0.2.1-bluesteel), so the label should mirror VERSION exactly.
export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
export const CODENAME = 'Blue Steel'
export const BUILD_META = typeof __APP_BUILD_META__ !== 'undefined' ? __APP_BUILD_META__ : {}

function shortSha(sha) {
	if (!sha || typeof sha !== 'string') return ''
	return sha.slice(0, 7)
}

const shaParts = [
	['meta', BUILD_META.metaSha],
	['client', BUILD_META.clientSha],
	['server', BUILD_META.serverSha],
	['worker', BUILD_META.workerSha],
	['control', BUILD_META.controlSha],
]
	.map(([name, sha]) => {
		const short = shortSha(sha)
		return short ? `${name}:${short}` : ''
	})
	.filter(Boolean)
	.join(' ')

// Display form: "v0.2.1-bluesteel (meta:abc1234 client:def5678 ...)"
export const VERSION_LABEL = shaParts ? `v${VERSION} (${shaParts})` : `v${VERSION}`
