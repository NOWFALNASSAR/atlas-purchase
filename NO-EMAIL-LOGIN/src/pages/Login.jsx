import { useEffect, useState } from 'react'
import { db } from '../lib/db'

/* ==================================================================
   SIGN IN

   No email addresses. People choose a name when they sign up and type
   that name, or their employee ID, to get in.

   Underneath, Supabase still authenticates on an email, because that
   cannot be turned off. So the app makes one up — nowfal@atlas.internal
   — which nobody ever sees or types. It is a key in a table, not a way
   of contacting anyone. .internal is unroutable by design, so one of
   these can never reach a real inbox by accident.
   ================================================================== */

const DOMAIN = 'atlas.internal'

const clean = s => s.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')

export default function Login() {
  const [mode, setMode] = useState('in')          // 'in' | 'up'
  const [login, setLogin] = useState('')          // username or employee ID
  const [pw, setPw] = useState('')

  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [empCode, setEmpCode] = useState('')

  const [taken, setTaken] = useState(null)        // null = not checked yet
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)

  /* tell them the name is taken while they type, not after they submit */
  useEffect(() => {
    if (mode !== 'up' || username.length < 3) { setTaken(null); return }
    let live = true
    const t = setTimeout(async () => {
      const { data, error } = await db.rpc('username_available', { p_login: username })
      if (live && !error) setTaken(data === false)
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [username, mode])

  async function signIn() {
    const id = login.trim()
    if (!id) return setFail('Type your username or employee ID')

    const { data: address, error } = await db.rpc('email_for_login', { p_login: id })

    if (error) return setFail(error.message)
    if (!address) return setFail(
      'No account with that name. Check the spelling, or ask your admin — ' +
      'they can see every username under Masters, Users.')

    const res = await db.auth.signInWithPassword({ email: address, password: pw })
    if (res.error) {
      setFail(res.error.message.toLowerCase().includes('credential')
        ? 'That password is not right. Your admin can set you a new one.'
        : res.error.message)
    }
  }

  async function signUp() {
    if (!name.trim()) return setFail('Type your full name')
    if (username.length < 3) return setFail('Your username needs at least 3 characters')
    if (taken) return setFail('Somebody already uses that name. Try another.')
    if (pw.length < 6) return setFail('Your password needs at least 6 characters')

    const { error } = await db.auth.signUp({
      email: `${username}@${DOMAIN}`,
      password: pw,
      options: { data: {
        full_name: name.trim(),
        username,
        emp_code: empCode.trim() || null
      } }
    })

    if (error) {
      setFail(error.message.toLowerCase().includes('already registered')
        ? 'Somebody already uses that name. Try another.'
        : error.message)
      return
    }

    setErr(false)
    setMsg('Account created. Your admin has to set your role before you can do '
         + 'anything — ask them, then sign in.')
    setMode('in')
    setLogin(username)
  }

  function setFail(text) { setMsg(text); setErr(true); setBusy(false) }

  async function go(e) {
    e.preventDefault()
    setBusy(true); setMsg(''); setErr(false)
    if (mode === 'in') await signIn()
    else await signUp()
    setBusy(false)
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_1fr]">

      <div className="flex flex-col justify-between bg-ink px-6 py-10 lg:px-14 lg:py-14">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gold text-base font-bold text-white">A</div>
          <span className="text-base font-semibold text-white">Atlas</span>
        </div>

        <div className="hidden max-w-md lg:block">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Purchase, stock, sales and tasks, in one place.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-white/55">
            Every order and every task carries its own trail — who raised it, who
            changed it, who approved it and when.
          </p>
        </div>

        <div className="mt-8 text-xs text-white/35 lg:mt-0">Atlas Maharani Group</div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-paper px-6 py-10 lg:px-10">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">
            {mode === 'in' ? 'Sign in' : 'Create your account'}
          </h2>
          <p className="mb-6 mt-1 text-sm text-slate2">
            {mode === 'in'
              ? 'Your username or your employee ID.'
              : 'Pick a name you will remember. You will type it every day.'}
          </p>

          <form onSubmit={go} className="space-y-4">
            {mode === 'in' ? (
              <div>
                <label>Username or employee ID</label>
                <input value={login} onChange={e => setLogin(e.target.value)}
                  autoCapitalize="none" autoCorrect="off" autoComplete="username"
                  placeholder="nowfal" required />
              </div>
            ) : (
              <>
                <div>
                  <label>Full name</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    required autoComplete="name" placeholder="As it should appear on orders" />
                </div>

                <div>
                  <label>Username</label>
                  <input value={username} onChange={e => setUsername(clean(e.target.value))}
                    autoCapitalize="none" autoCorrect="off" autoComplete="username"
                    required minLength={3} placeholder="nowfal" />
                  <p className={'mt-1 text-2xs ' +
                    (taken ? 'font-semibold text-bad'
                     : taken === false ? 'font-semibold text-good' : 'text-slate2')}>
                    {taken ? 'Somebody already uses that name.'
                      : taken === false ? 'That name is free.'
                      : 'Letters and numbers, no spaces. This is what you type to sign in.'}
                  </p>
                </div>

                <div>
                  <label>Employee ID (optional)</label>
                  <input value={empCode} onChange={e => setEmpCode(e.target.value)}
                    autoCapitalize="characters" autoCorrect="off" placeholder="EMP014" />
                  <p className="mt-1 text-2xs text-slate2">
                    You can sign in with this too.
                  </p>
                </div>
              </>
            )}

            <div>
              <label>Password</label>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                required minLength={6}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
              {mode === 'up' && (
                <p className="mt-1 text-2xs text-slate2">
                  At least 6 characters. There is no email here, so if you forget it
                  your admin sets you a new one.
                </p>
              )}
            </div>

            {msg && (
              <div className={'rounded-md px-3 py-2.5 text-sm ' +
                (err ? 'bg-bad/10 text-bad' : 'bg-good/10 text-good')}>
                {msg}
              </div>
            )}

            <button className="btn-dark w-full" disabled={busy || (mode === 'up' && taken)}>
              {busy ? 'Please wait' : mode === 'in' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button type="button"
            className="mt-5 w-full text-sm font-medium text-slate2 hover:text-ink"
            onClick={() => {
              setMode(m => (m === 'in' ? 'up' : 'in'))
              setMsg(''); setErr(false); setTaken(null)
            }}>
            {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>

          {mode === 'in' && (
            <p className="mt-4 text-center text-2xs text-mute">
              Forgotten your password? Ask your admin — they can set you a new one
              from the Users screen.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
