import { useEffect, useState, createContext, useContext } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { db, roleLabel } from './lib/db'

import Login     from './pages/Login'
import Dashboard from './pages/Dashboard'
import POList    from './pages/POList'
import NewPO     from './pages/NewPO'
import PODetail  from './pages/PODetail'
import Suppliers from './pages/Suppliers'
import Items     from './pages/Items'
import Users     from './pages/Users'
import Compare   from './pages/Compare'

const Ctx = createContext(null)
export const useMe = () => useContext(Ctx)

export default function App() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(null)

  useEffect(() => {
    db.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setMe(null); return }
    db.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setMe({ ...data, email: session.user.email }))
  }, [session])

  if (session === undefined) return <Splash text="Loading" />
  if (!session) return <Login />
  if (!me) return <Splash text="Opening your account" />
  if (!me.active) return <Splash text="Your login is switched off. Ask the admin to activate it." />

  return (
    <Ctx.Provider value={me}>
      <div className="min-h-screen pb-24 md:pb-0">
        <TopBar me={me} />
        <main className="mx-auto max-w-6xl px-4 py-5">
          <Routes>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/orders"      element={<POList />} />
            <Route path="/orders/new"  element={<NewPO />} />
            <Route path="/orders/:id"  element={<PODetail />} />
            <Route path="/compare"     element={<Compare />} />
            <Route path="/suppliers"   element={<Suppliers />} />
            <Route path="/items"       element={<Items />} />
            <Route path="/users"       element={<Users />} />
            <Route path="*"            element={<Navigate to="/" />} />
          </Routes>
        </main>
        <BottomNav me={me} />
      </div>
    </Ctx.Provider>
  )
}

function Splash({ text }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-8 text-center text-white">
      <div>
        <div className="mb-3 text-2xl font-bold tracking-tight">Atlas Purchase</div>
        <div className="text-sm text-white/60">{text}</div>
      </div>
    </div>
  )
}

function TopBar({ me }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const links = navLinks(me.role)

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <NavLink to="/" className="text-lg font-bold tracking-tight">Atlas Purchase</NavLink>

        <nav className="hidden gap-1 md:flex">
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.to === '/'}
              className={({ isActive }) =>
                'rounded-md px-3 py-1.5 text-sm font-medium ' +
                (isActive ? 'bg-white/15' : 'text-white/70 hover:text-white')}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <button onClick={() => setOpen(o => !o)} className="ml-auto text-right leading-tight">
          <div className="text-sm font-semibold">{me.full_name || me.email}</div>
          <div className="text-[11px] text-white/60">{roleLabel(me.role)}</div>
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-ink px-4 py-3">
          <div className="mx-auto max-w-6xl">
            <button className="text-sm text-white/80 underline"
              onClick={async () => { await db.auth.signOut(); nav('/') }}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  )
}

function BottomNav({ me }) {
  const links = navLinks(me.role).slice(0, 5)
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-white md:hidden">
      {links.map(l => (
        <NavLink key={l.to} to={l.to} end={l.to === '/'}
          className={({ isActive }) =>
            'flex-1 py-3 text-center text-[11px] font-semibold ' +
            (isActive ? 'text-gold' : 'text-slate2')}>
          {l.short}
        </NavLink>
      ))}
    </nav>
  )
}

function navLinks(role) {
  const base = [
    { to: '/',          label: 'Dashboard', short: 'Home' },
    { to: '/orders',    label: 'Orders',    short: 'Orders' },
    { to: '/orders/new',label: 'New order', short: 'New' },
    { to: '/compare',   label: 'Compare',   short: 'Compare' }
  ]
  if (['hod', 'admin'].includes(role))
    base.push({ to: '/suppliers', label: 'Suppliers', short: 'Suppliers' },
              { to: '/items',     label: 'Items',     short: 'Items' })
  if (role === 'admin')
    base.push({ to: '/users', label: 'Users', short: 'Users' })
  return base
}
