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

// Short git SHA of THIS client build (from BUILD_META, injected at build time).
// This is the ONLY SHA the client legitimately knows at build time — it *is*
// the client build. The server/worker/control/meta SHAs are unknowable here
// (the shell is de-baked from the pod image) and are fetched at runtime from
// /api/v1/common/version; see composables/useVersionLabel.js for the merged
// label shown in the UI.
//
// Sessions are tagged with this so the picker can tell which exact build saved
// a session vs. which is loading it — a discipline-free "different build?"
// signal that never silently misses a doc-shape change the way a manual version
// bump can. Empty string when no SHA was injected (e.g. plain local dev).
export const CLIENT_SHA = shortSha(BUILD_META.clientSha)
