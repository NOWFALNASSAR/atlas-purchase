import { useState } from 'react'
import { db } from '../lib/db'

export default function Login() {
  const [mode, setMode] = useState('in')      // 'in' | 'up'
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function go(e) {
    e.preventDefault()
    setBusy(true); setMsg('')
    const { error } = mode === 'in'
      ? await db.auth.signInWithPassword({ email, password: pw })
      : await db.auth.signUp({ email, password: pw, options: { data: { full_name: name } } })
    if (error) setMsg(error.message)
    else if (mode === 'up') setMsg('Account created. Ask the admin to set your role, then sign in.')
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-ink px-6">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8">
          <div className="text-2xl font-bold tracking-tight text-white">Atlas Purchase</div>
          <div className="mt-1 text-sm text-white/50">Purchase orders, approvals and supplier rates</div>
        </div>

        <form onSubmit={go} className="card space-y-4 p-5">
          {mode === 'up' && (
            <div>
              <label>Full name</label>
              <input value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
            </div>
          )}
          <div>
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                   required autoComplete="username" />
          </div>
          <div>
            <label>Password</label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                   required minLength={6} autoComplete="current-password" />
          </div>

          {msg && <div className="rounded-md bg-gold/10 px-3 py-2 text-sm text-gold">{msg}</div>}

          <button className="btn-dark w-full" disabled={busy}>
            {busy ? 'Please wait' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>

          <button type="button" className="w-full text-sm text-slate2 underline"
                  onClick={() => { setMode(m => (m === 'in' ? 'up' : 'in')); setMsg('') }}>
            {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
