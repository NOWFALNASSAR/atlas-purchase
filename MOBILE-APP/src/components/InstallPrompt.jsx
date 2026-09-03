import { useEffect, useState } from 'react'

/* ==================================================================
   INSTALL

   Android and desktop Chrome fire beforeinstallprompt, so we can show
   a real button.

   iPhone does not. Safari has never supported it, and it is the only
   engine allowed on iOS, so there is no button to press — the person
   has to use Share, then Add to Home Screen. So we detect iOS and show
   the instructions instead of a button that could not work.

   Either way this appears once. Dismiss it and it stays dismissed.
   ================================================================== */

const DISMISSED = 'atlasInstallDismissed'

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null)
  const [show, setShow] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    if (isStandalone()) return                       // already installed
    if (localStorage.getItem(DISMISSED)) return

    if (isIos()) { setIos(true); setShow(true); return }

    const onPrompt = e => {
      e.preventDefault()
      setPrompt(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', () => setShow(false))
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISSED, '1')
    setShow(false)
  }

  async function install() {
    if (!prompt) return
    prompt.prompt()
    await prompt.userChoice
    setPrompt(null)
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="safe-b fixed inset-x-3 bottom-16 z-40 md:inset-x-auto md:bottom-6 md:right-6 md:max-w-sm">
      <div className="card flex items-start gap-3 p-4 shadow-pop">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-lg" />

        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Put Atlas on your home screen</div>

          {ios ? (
            <p className="mt-1 text-xs text-slate2">
              Tap <strong>Share</strong> at the bottom of Safari, scroll down, then
              tap <strong>Add to Home Screen</strong>.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate2">
              It opens like an app, without the browser bar, and still works when
              the wifi drops.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            {!ios && (
              <button className="btn-dark btn-sm" onClick={install}>Install</button>
            )}
            <button className="btn-ghost btn-sm" onClick={dismiss}>
              {ios ? 'Got it' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- offline banner ---------------- */

export function OfflineBar() {
  const [off, setOff] = useState(!navigator.onLine)

  useEffect(() => {
    const on = () => setOff(false)
    const down = () => setOff(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', down)
    }
  }, [])

  if (!off) return null

  return (
    <div className="sticky top-14 z-30 bg-bad px-4 py-1.5 text-center text-xs font-semibold text-white">
      No internet. You can read what is already loaded, but nothing will save.
    </div>
  )
}
