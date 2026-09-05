import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { configured, missingSetting } from './lib/db'
import './index.css'

/* The service worker is what makes the app installable. It is
   registered only in a real build — during development it would just
   get in the way of seeing your own changes. */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err =>
      console.warn('Service worker did not register:', err))
  })
}

/* ==================================================================
   A blank white page is the worst thing this app can do, because it
   tells nobody anything. Two guards stop it:

     1. a settings check, for the case where the app was deployed
        without its two environment variables
     2. an error boundary, for anything else that throws during render

   Both put the actual problem on the screen.
   ================================================================== */

class Boundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Atlas crashed:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <Screen title="Something broke on this screen">
        <p>
          The page could not be drawn. The technical detail is below — send it
          to whoever maintains the app.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-paper p-3 text-xs text-bad">
          {String(this.state.error?.stack || this.state.error)}
        </pre>
        <button className="btn-dark mt-4" onClick={() => window.location.assign('/')}>
          Back to the dashboard
        </button>
      </Screen>
    )
  }
}

function Setup() {
  return (
    <Screen title="Atlas is not connected to its database">
      <p>
        The app was built without {missingSetting}. Until that is fixed nobody
        can sign in.
      </p>

      <h3 className="mb-1.5 mt-5 text-sm font-semibold">On Vercel</h3>
      <p>
        Settings → Environment Variables. Add both of these, then
        <strong> redeploy</strong> — Vercel bakes them in at build time, so an
        existing deployment will not pick them up on its own.
      </p>

      <h3 className="mb-1.5 mt-5 text-sm font-semibold">On your laptop</h3>
      <p>
        Copy <code className="rounded bg-paper px-1">.env.example</code> to{' '}
        <code className="rounded bg-paper px-1">.env</code>, fill in both
        values, and restart <code className="rounded bg-paper px-1">npm run dev</code>.
      </p>

      <pre className="mt-4 overflow-x-auto rounded-md bg-paper p-3 text-xs">
{`VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
      </pre>

      <p className="mt-4 text-xs text-slate2">
        Both values are in Supabase under Project Settings → API. The anon key
        is meant to be public; it is safe in the browser.
      </p>
    </Screen>
  )
}

function Screen({ title, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-5 py-10">
      <div className="card w-full max-w-lg p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gold text-base font-bold text-white">A</div>
          <span className="text-base font-semibold">Atlas</span>
        </div>
        <h1 className="mb-2 text-lg font-semibold tracking-tight">{title}</h1>
        <div className="space-y-2 text-sm leading-relaxed text-slate2">{children}</div>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {configured ? (
      <Boundary>
        <BrowserRouter><App /></BrowserRouter>
      </Boundary>
    ) : (
      <Setup />
    )}
  </React.StrictMode>
)
