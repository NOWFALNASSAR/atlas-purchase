import { useState } from 'react'
import { db } from '../lib/db'

export default function Login() {
  const [mode, setMode] = useState('in')      // 'in' | 'up'
  const [login, setLogin] = useState('')      // username, or an email
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)

  /* Supabase signs people in on an email address, and that has not
     changed. What has changed is that a username can be typed instead:
     we ask the database which email it belongs to, then sign in as
     normal. An email typed directly still works. */
  async function resolve(identifier) {
    const id = identifier.trim()
    if (id.includes('@')) return id
    const { data, error } = await db.rpc('email_for_login', { p_login: id })
    if (error || !data) return null
    return data
  }

  async function go(e) {
    e.preventDefault()
    setBusy(true); setMsg(''); setErr(false)

    if (mode === 'in') {
      const addr = await resolve(login)
      if (!addr) {
        setMsg('No account with that username. Check the spelling, or use your email address.')
        setErr(true); setBusy(false); return
      }
      const { error } = await db.auth.signInWithPassword({ email: addr, password: pw })
      if (error) { setMsg(error.message); setErr(true) }
    } else {
      const { error } = await db.auth.signUp({
        email, password: pw,
        options: { data: { full_name: name, username: username.trim().toLowerCase() } }
      })
      if (error) { setMsg(error.message); setErr(true) }
      else setMsg('Account created. Ask the admin to set your role, then sign in.')
    }

    setBusy(false)
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_1fr]">

      {/* On a phone this panel is a short header. On a laptop it becomes
          the left half of the screen, so the form is not marooned in the
          middle of 1900 empty pixels. */}
      <div className="flex flex-col justify-between bg-ink px-6 py-10 lg:px-14 lg:py-14">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gold text-base font-bold text-white">A</div>
          <span className="text-base font-semibold text-white">Atlas</span>
        </div>

        <div className="hidden max-w-md lg:block">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Purchase orders, approvals and supplier rates, in one place.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-white/55">
            Every order carries its own trail — who raised it, who changed a
            rate, who approved it and when.
          </p>
        </div>

        <div className="mt-8 text-xs text-white/35 lg:mt-0">
          Atlas Maharani Group
        </div>
      </div>

      {/* form */}
      <div className="flex flex-1 items-center justify-center bg-paper px-6 py-10 lg:px-10">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">
            {mode === 'in' ? 'Sign in' : 'Create your account'}
          </h2>
          <p className="mb-6 mt-1 text-sm text-slate2">
            {mode === 'in'
              ? 'Your username, or the email your admin has on file.'
              : 'After signing up, your admin sets what you can see and do.'}
          </p>

          <form onSubmit={go} className="space-y-4">
            {mode === 'up' && (
              <>
                <div>
                  <label>Full name</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    required autoComplete="name" placeholder="As it should appear on orders" />
                </div>
                <div>
                  <label>Username</label>
                  <input value={username} autoCapitalize="none" autoCorrect="off"
                    onChange={e => setUsername(e.target.value.replace(/\s+/g, ''))}
                    required minLength={3} placeholder="nowfal" autoComplete="username" />
                  <p className="mt-1 text-2xs text-slate2">
                    This is what you will type to sign in. No spaces.
                  </p>
                </div>
                <div>
                  <label>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required inputMode="email" autoComplete="email" />
                  <p className="mt-1 text-2xs text-slate2">
                    Used to reset your password. You will not need it to sign in.
                  </p>
                </div>
              </>
            )}

            {mode === 'in' && (
              <div>
                <label>Username</label>
                <input value={login} autoCapitalize="none" autoCorrect="off"
                  onChange={e => setLogin(e.target.value)}
                  required autoComplete="username" placeholder="nowfal" />
              </div>
            )}

            <div>
              <label>Password</label>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                required minLength={6}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
            </div>

            {msg && (
              <div className={'rounded-md px-3 py-2.5 text-sm ' +
                (err ? 'bg-bad/10 text-bad' : 'bg-gold2 text-gold')}>
                {msg}
              </div>
            )}

            <button className="btn-dark w-full" disabled={busy}>
              {busy ? 'Please wait' : mode === 'in' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button type="button"
            className="mt-5 w-full text-sm font-medium text-slate2 hover:text-ink"
            onClick={() => { setMode(m => (m === 'in' ? 'up' : 'in')); setMsg(''); setErr(false) }}>
            {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
