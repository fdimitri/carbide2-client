// Build-time app version + release codename, surfaced in the UI footer/header.
//
// `__APP_VERSION__` is injected by Vite from package.json (see vite.config.js).
// The codename rides ALONGSIDE SemVer (Zoolander theme); "Blue Steel" is the
// first real release. Bump CODENAME only when a new release is cut.
export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
export const CODENAME = 'Blue Steel'

// Display form: "v0.1.0 — Blue Steel"
export const VERSION_LABEL = `v${VERSION} — ${CODENAME}`
