// A deploy replaces the app's files: a tab opened before it still asks for
// the old ones (each page's code is a file named by its content), which are
// gone. The way out is a reload, which brings the new version. Reloads once in
// RELOAD_GUARD_MS, so a file that is missing for another reason shows the
// error page instead of reloading forever.
const RELOADED_AT_KEY = "sbin:reloaded-for-new-version"
const RELOAD_GUARD_MS = 10_000

// Reloads the page unless it just did; true when it reloads.
export function reloadForNewVersion() {
    try {
        const last = Number(sessionStorage.getItem(RELOADED_AT_KEY))
        if (last && Date.now() - last < RELOAD_GUARD_MS) return false
        sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()))
    } catch {
        // Without storage there is no guard: reloading once is still the best bet.
    }
    window.location.reload()
    return true
}
