import { createContext, useContext, useEffect, useState } from 'react'

/* ==================================================================
   INSTALLING

   The automatic banner is unreliable, and the reasons are all outside
   our control:

   • Opening the link from WhatsApp uses WhatsApp's own in-app browser,
     which cannot install anything. This is the usual reason nothing
     appears — the link has to be opened in Chrome.
   • Chrome only fires beforeinstallprompt when it feels like it, after
     some engagement with the site.
   • iOS Safari has never supported it at all.
   • Once dismissed, it does not come back.

   So the banner is a convenience, not the mechanism. There is always an
   "Install app" item in the account menu that explains what to tap on
   whatever browser the person is actually using.
   ================================================================== */

const DISMISSED = 'atlasInstallDismissed'

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

const ua = () => navigator.userAgent || ''

export function browserKind() {
  const s = ua()
  if (/FBAN|FBAV|Instagram|Line\//i.test(s)) return 'inapp'
  // WhatsApp's browser reports as Chrome but sets wv (webview)
  if (/\bwv\b/i.test(s) && /Android/i.test(s)) return 'inapp'
  if (/iPhone|iPad|iPod/i.test(s) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return /CriOS|FxiOS|EdgiOS/i.test(s) ? 'ios-other' : 'ios-safari'
  }
  if (/SamsungBrowser/i.test(s)) return 'samsung'
  if (/Firefox/i.test(s)) return 'firefox'
  if (/Android/i.test(s)) return 'android-chrome'
  return 'desktop'
}

/* ---------- shared state, so the menu and the banner agree ---------- */

const Ctx = createContext(null)
export const useInstall = () => useContext(Ctx)

export function InstallProvider({ children }) {
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(isStandalone())
  const [sheet, setSheet] = useState(false)
  const [banner, setBanner] = useState(false)

  useEffect(() => {
    if (installed) return

    const onPrompt = e => {
      e.preventDefault()
      setDeferred(e)
      if (!localStorage.getItem(DISMISSED)) setBanner(true)
    }
    const onInstalled = () => {
      setInstalled(true); setBanner(false); setSheet(false); setDeferred(null)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    // iPhone never fires the event, so offer the banner once anyway
    if (browserKind() === 'ios-safari' && !localStorage.getItem(DISMISSED)) {
      setBanner(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [installed])

  async function install() {
    if (!deferred) { setSheet(true); return }
    deferred.prompt()
    const res = await deferred.userChoice
    setDeferred(null)
    setBanner(false)
    if (res?.outcome !== 'accepted') setSheet(true)
  }

  const value = {
    installed, canPrompt: !!deferred, install,
    openHelp: () => setSheet(true),
    dismissBanner: () => { localStorage.setItem(DISMISSED, '1'); setBanner(false) }
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      {banner && !installed && <Banner />}
      {sheet && <HowTo onClose={() => setSheet(false)} />}
    </Ctx.Provider>
  )
}

/* ---------- the banner ---------- */

function Banner() {
  const { install, dismissBanner, canPrompt } = useInstall()
  const kind = browserKind()

  return (
    <div className="safe-b fixed inset-x-3 bottom-16 z-40 md:inset-x-auto md:bottom-6 md:right-6 md:max-w-sm">
      <div className="card flex items-start gap-3 p-4 shadow-pop">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Put Atlas on your home screen</div>
          <p className="mt-1 text-xs text-slate2">
            {kind === 'ios-safari'
              ? 'Tap Share at the bottom, then Add to Home Screen.'
              : 'It opens like an app, without the browser bar.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn-dark btn-sm" onClick={install}>
              {canPrompt ? 'Install' : 'Show me how'}
            </button>
            <button className="btn-ghost btn-sm" onClick={dismissBanner}>Not now</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- what to tap, on whatever they are using ---------- */

function HowTo({ onClose }) {
  const kind = browserKind()

  const steps = {
    'inapp': {
      title: 'Open this in Chrome first',
      body: (
        <>
          <p>
            You have opened Atlas inside another app's browser — WhatsApp,
            Facebook or similar. Those cannot install anything.
          </p>
          <p className="mt-2">
            Tap the <strong>⋮</strong> or <strong>⋯</strong> in the corner, choose{' '}
            <strong>Open in browser</strong> or <strong>Open in Chrome</strong>, then
            try again from there.
          </p>
          <p className="mt-2 text-2xs">
            This is the usual reason the install option does not appear.
          </p>
        </>
      )
    },
    'android-chrome': {
      title: 'Chrome on Android',
      body: (
        <>
          <p>Tap <strong>⋮</strong> at the top right of Chrome.</p>
          <p className="mt-2">
            Choose <strong>Install app</strong>, or <strong>Add to Home screen</strong>
            if that is what it says.
          </p>
        </>
      )
    },
    'samsung': {
      title: 'Samsung Internet',
      body: (
        <>
          <p>Tap the <strong>≡</strong> menu at the bottom right.</p>
          <p className="mt-2">Choose <strong>Add page to</strong> → <strong>Home screen</strong>.</p>
        </>
      )
    },
    'ios-safari': {
      title: 'Safari on iPhone',
      body: (
        <>
          <p>Tap <strong>Share</strong> — the square with an arrow, at the bottom.</p>
          <p className="mt-2">Scroll down and tap <strong>Add to Home Screen</strong>.</p>
        </>
      )
    },
    'ios-other': {
      title: 'Use Safari on iPhone',
      body: (
        <p>
          Only Safari can add an app to the home screen on iPhone. Open this
          address in Safari, then Share → Add to Home Screen.
        </p>
      )
    },
    'firefox': {
      title: 'Firefox',
      body: (
        <p>
          Tap <strong>⋮</strong> and choose <strong>Install</strong> or{' '}
          <strong>Add to Home screen</strong>. Chrome handles this better if you
          have it.
        </p>
      )
    },
    'desktop': {
      title: 'On a computer',
      body: (
        <p>
          In Chrome or Edge, look for the small install icon at the right of the
          address bar. Or open the <strong>⋮</strong> menu and choose{' '}
          <strong>Install Atlas</strong>.
        </p>
      )
    }
  }[browserKind()] || {}

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
      onClick={onClose}>
      <div className="safe-b w-full max-w-md rounded-t-xl bg-white p-5 shadow-pop md:rounded-xl"
        onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
          <div>
            <div className="text-base font-semibold">Install Atlas</div>
            <div className="text-2xs text-slate2">{steps.title}</div>
          </div>
        </div>

        <div className="space-y-1 text-sm text-slate2">{steps.body}</div>

        {kind !== 'inapp' && (
          <p className="mt-4 rounded-md bg-paper px-3 py-2.5 text-xs text-slate2">
            If you opened this link from WhatsApp, the install option will not
            appear. Open the address in Chrome instead.
          </p>
        )}

        <button className="btn-dark mt-4 w-full" onClick={onClose}>Got it</button>
      </div>
    </div>
  )
}
