import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { migrateLocalStorage } from './lib/storage-migrate.js'
import { FITS_KEY, initFitsStore, replaceFitsDB } from './lib/fits-store.js'
import { initLocale } from './lib/i18n.js'

const mount = () => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Saved fits live in IndexedDB, which is async, while App.jsx reads them synchronously inside its
// useState initialisers — so the store has to be loaded into memory BEFORE the first render, not
// fetched during it. That is the whole reason mounting is deferred here.
//
// Order matters: load the library first (which also performs the one-time move out of
// localStorage), then run the schema migrations with it injected, so a future fit-shape migration
// still sees the fits even though they are no longer a localStorage key. Then persist whatever the
// migration changed.
;(async () => {
  try {
    let db
    try { db = await initFitsStore(localStorage.getItem(FITS_KEY)) } catch { db = {} }
    const loaded = JSON.stringify(db ?? {})
    const { external } = migrateLocalStorage(undefined, { external: { [FITS_KEY]: loaded } })
    const migrated = external?.[FITS_KEY]
    if (typeof migrated === 'string' && migrated !== loaded) {
      try { await replaceFitsDB(JSON.parse(migrated)) } catch {}
    }
  } catch (e) {
    // Never let a storage problem cost the user the app itself — ErrorBoundary can't catch this,
    // it happens before React exists.
    console.error('boot: storage init failed', e)
  }
  // Catalogs are lazy chunks, and t() is synchronous — so a non-English pref has to be RESOLVED
  // before the first render, or that render is English and visibly flips a moment later. Same
  // reason the fits are loaded above: React reads both without being able to wait.
  await initLocale()
  mount()
})()
