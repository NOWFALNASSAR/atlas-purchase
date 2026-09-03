import { useEffect, useState, createContext, useContext } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { db, roleLabel } from './lib/db'

import Login     from './pages/Login'
import Dashboard from './pages/Dashboard'
import POList    from './pages/POList'
import NewPO     from './pages/NewPO'
import PODetail  from './pages/PODetail'
import Suppliers from './pages/Suppliers'
import Items     from './pages/Items'
import Users     from './pages/Users'
import Roles     from './pages/Roles'
import Compare   from './pages/Compare'
import Reports   from './pages/Reports'
import Settings  from './pages/Settings'
import Insights  from './pages/Insights'
import Godown    from './pages/Godown'
import Transfers from './pages/Transfers'
import Inventory from './pages/Inventory'
import SalesDashboard from './pages/SalesDashboard'
import SalesBranches  from './pages/SalesBranches'
import Salesmen       from './pages/Salesmen'
import Targets        from './pages/Targets'
import SalesImport    from './pages/SalesImport'
import Tasks          from './pages/Tasks'
import NewTask        from './pages/NewTask'
import TaskDetail     from './pages/TaskDetail'
import TaskReports    from './pages/TaskReports'

const Ctx = createContext(null)
export const useMe = () => useContext(Ctx)

const EntityCtx = createContext(null)
export const useEntity = () => useContext(EntityCtx)

/* Rights come from the database, never from the browser. The menu below
   uses them to decide what to draw; RLS decides what is actually allowed. */
const PermCtx = createContext(() => false)
export const useCan = () => useContext(PermCtx)

/* ------------------------------------------------------------------ */
/* MODULES                                                             */
/* Each module is a separate area of the business with its own pages.  */
/* ------------------------------------------------------------------ */

const MODULES = [
  {
    key: 'purchase', label: 'Purchase', short: 'Buy',
    pages: [
      { to: '/',            label: 'Dashboard',       short: 'Home', end: true },
      { to: '/orders',      label: 'Purchase orders', short: 'Orders',   perm: 'po.view' },
      { to: '/orders/new',  label: 'New order',       short: 'New',      perm: 'po.create' },
      { to: '/compare',     label: 'Rate compare',    short: 'Rates',    perm: 'compare.view' },
      { to: '/reports',     label: 'Order reports',   short: 'Reports',  perm: 'reports.view' },
      { to: '/insights',    label: 'Insights',        short: 'Insights', perm: 'insights.view' }
    ]
  },
  {
    key: 'stock', label: 'Stock', short: 'Stock',
    pages: [
      { to: '/inventory',  label: 'Inventory', short: 'Stock',     perm: 'inventory.view' },
      { to: '/godown',     label: 'Godown',    short: 'Godown',    perm: 'godown.view' },
      { to: '/transfers',  label: 'Transfers', short: 'Transfers', perm: 'transfers.view' }
    ]
  },
  {
    key: 'sales', label: 'Sales', short: 'Sales',
    pages: [
      { to: '/sales',           label: 'Sales dashboard', short: 'Sales',    perm: 'sales.view' },
      { to: '/sales/branches',  label: 'Branches',        short: 'Branches', perm: 'sales.branches' },
      { to: '/sales/salesmen',  label: 'Salesmen',        short: 'Team',     perm: 'sales.salesmen' },
      { to: '/sales/targets',   label: 'Targets',         short: 'Targets',  perm: 'sales.targets.view' },
      { to: '/sales/import',    label: 'Upload sales',    short: 'Upload',   perm: 'sales.import' }
    ]
  },
  {
    key: 'tasks', label: 'Tasks', short: 'Tasks',
    pages: [
      { to: '/tasks',         label: 'Tasks',       short: 'Tasks',   perm: 'tasks.view' },
      { to: '/tasks/new',     label: 'Raise task',  short: 'Raise',   perm: 'tasks.create' },
      { to: '/tasks/reports', label: 'Performance', short: 'Reports', perm: 'tasks.reports' }
    ]
  },
  {
    key: 'masters', label: 'Masters', short: 'Setup',
    pages: [
      { to: '/suppliers', label: 'Suppliers', short: 'Suppliers', perm: 'suppliers.view' },
      { to: '/items',     label: 'Items',     short: 'Items',     perm: 'items.view' },
      { to: '/users',     label: 'Users',     short: 'Users',     perm: 'users.manage' },
      { to: '/roles',     label: 'Roles',     short: 'Roles',     perm: 'roles.manage' },
      { to: '/settings',  label: 'Settings',  short: 'Settings',  perm: 'settings.manage' }
    ]
  }
]

const moduleFor = (path) => {
  if (path.startsWith('/tasks')) return 'tasks'
  if (path.startsWith('/sales')) return 'sales'
  if (['/inventory', '/godown', '/transfers'].some(p => path.startsWith(p))) return 'stock'
  if (['/suppliers', '/items', '/users', '/roles', '/settings'].some(p => path.startsWith(p))) return 'masters'
  return 'purchase'
}

/* A page with no perm is open to every signed-in user (the dashboard).
   A module is shown only if at least one of its pages is. */
const allowed = (page, can) => !page.perm || can(page.perm)
const moduleAllowed = (mod, can) => mod.pages.some(p => allowed(p, can))
const visiblePages = (mod, can) => (mod?.pages || []).filter(p => allowed(p, can))

/* ------------------------------------------------------------------ */

export default function App() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(null)
  const [entities, setEntities] = useState([])
  const [entityId, setEntityId] = useState('mixed')
  const [perms, setPerms] = useState(null)

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

  useEffect(() => {
    if (!me) { setPerms(null); return }
    db.rpc('my_permissions').then(({ data, error }) => {
      // If the rights migration has not been run yet, fall back to the old
      // behaviour rather than showing an empty app.
      setPerms(error ? null : (data || []))
      if (error) console.warn('Rights not installed yet — run supabase/19_permissions.sql')
    })
  }, [me])

  useEffect(() => {
    if (!me) return
    db.from('entities').select('*').eq('active', true).order('code').then(({ data }) => {
      const list = (me.entity_ids?.length ? data.filter(e => me.entity_ids.includes(e.id)) : data) || []
      setEntities(list)
      const saved = localStorage.getItem('entityFilter')
      if (list.length === 1) setEntityId(list[0].id)
      else if (saved && (saved === 'mixed' || list.some(e => e.id === saved))) setEntityId(saved)
      else setEntityId('mixed')
    })
  }, [me])

  function chooseEntity(id) {
    setEntityId(id)
    localStorage.setItem('entityFilter', id)
  }

  if (session === undefined) return <Splash text="Loading" />
  if (!session) return <Login />
  if (!me) return <Splash text="Opening your account" />
  if (!me.active) return <Splash text="Your login is switched off. Ask the admin to activate it." />

  const can = makeCan(me, perms)

  return (
    <Ctx.Provider value={me}>
     <PermCtx.Provider value={can}>
     <EntityCtx.Provider value={{ entities, entityId, setEntityId: chooseEntity }}>
      <div className="min-h-screen pb-24 md:pb-0">
        <TopBar me={me} can={can} />
        <main className="mx-auto max-w-6xl px-4 py-5">
          <Routes>
            <Route path="/"                 element={<Dashboard />} />
            <Route path="/orders"           element={<Need p="po.view"><POList /></Need>} />
            <Route path="/orders/new"       element={<Need p="po.create"><NewPO /></Need>} />
            <Route path="/orders/:id"       element={<Need p="po.view"><PODetail /></Need>} />
            <Route path="/compare"          element={<Need p="compare.view"><Compare /></Need>} />
            <Route path="/reports"          element={<Need p="reports.view"><Reports /></Need>} />
            <Route path="/insights"         element={<Need p="insights.view"><Insights /></Need>} />

            <Route path="/inventory"        element={<Need p="inventory.view"><Inventory /></Need>} />
            <Route path="/godown"           element={<Need p="godown.view"><Godown /></Need>} />
            <Route path="/transfers"        element={<Need p="transfers.view"><Transfers /></Need>} />

            <Route path="/sales"            element={<Need p="sales.view"><SalesDashboard /></Need>} />
            <Route path="/sales/branches"   element={<Need p="sales.branches"><SalesBranches /></Need>} />
            <Route path="/sales/salesmen"   element={<Need p="sales.salesmen"><Salesmen /></Need>} />
            <Route path="/sales/targets"    element={<Need p="sales.targets.view"><Targets /></Need>} />
            <Route path="/sales/import"     element={<Need p="sales.import"><SalesImport /></Need>} />

            <Route path="/tasks"            element={<Need p="tasks.view"><Tasks /></Need>} />
            <Route path="/tasks/new"        element={<Need p="tasks.create"><NewTask /></Need>} />
            <Route path="/tasks/reports"    element={<Need p="tasks.reports"><TaskReports /></Need>} />
            <Route path="/tasks/:id"        element={<Need p="tasks.view"><TaskDetail /></Need>} />

            <Route path="/suppliers"        element={<Need p="suppliers.view"><Suppliers /></Need>} />
            <Route path="/items"            element={<Need p="items.view"><Items /></Need>} />
            <Route path="/users"            element={<Need p="users.manage"><Users /></Need>} />
            <Route path="/roles"            element={<Need p="roles.manage"><Roles /></Need>} />
            <Route path="/settings"         element={<Need p="settings.manage"><Settings /></Need>} />
            <Route path="*"                 element={<Navigate to="/" />} />
          </Routes>
        </main>
        <BottomNav me={me} can={can} />
      </div>
     </EntityCtx.Provider>
     </PermCtx.Provider>
    </Ctx.Provider>
  )
}

/* Typing a URL should not get you into a page your rights do not cover.
   This is politeness, not security — RLS is the security. */
function Need({ p, children }) {
  const can = useCan()
  if (can(p)) return children
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-2 text-base font-bold">Not available to you</div>
      <p className="text-sm text-slate2">
        Your rights do not include this page. Ask the admin to switch it on
        under Masters → Users.
      </p>
    </div>
  )
}

/* Rights come from the database. If the migration has not been run yet the
   RPC fails, and we fall back to the role rules the app shipped with, so an
   un-migrated database still works instead of showing an empty menu. */
const LEGACY = {
  'insights.view':     ['manager', 'hod', 'admin'],
  'sales.import':      ['manager', 'hod', 'admin'],
  'suppliers.view':    ['hod', 'admin'],
  'suppliers.edit':    ['hod', 'admin'],
  'items.view':        ['hod', 'admin'],
  'items.edit':        ['hod', 'admin'],
  'users.manage':      ['admin'],
  'roles.manage':      ['admin'],
  'settings.manage':   ['admin']
}

function makeCan(me, perms) {
  if (perms === null) {
    return code => (LEGACY[code] ? LEGACY[code].includes(me.role) : true)
  }
  return code => perms.includes(code)
}

function Splash({ text }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-8 text-center text-white">
      <div>
        <div className="mb-3 text-2xl font-bold tracking-tight">Atlas</div>
        <div className="text-sm text-white/60">{text}</div>
      </div>
    </div>
  )
}

function TopBar({ me, can }) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  const mods = MODULES.filter(m => moduleAllowed(m, can))
  const current = moduleFor(pathname)
  const pages = visiblePages(mods.find(m => m.key === current), can)

  return (
    <header className="sticky top-0 z-20 bg-ink text-white">
      {/* module row */}
      <div className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2">
          <NavLink to="/" className="mr-3 text-base font-bold tracking-tight">Atlas</NavLink>

          {mods.map(m => (
            <NavLink key={m.key} to={visiblePages(m, can)[0].to}
              className={'rounded-md px-3 py-1.5 text-sm font-semibold ' +
                (current === m.key ? 'bg-white text-ink' : 'text-white/60 hover:text-white')}>
              {m.label}
            </NavLink>
          ))}

          <button onClick={() => setOpen(o => !o)} className="ml-auto text-right leading-tight">
            <div className="text-[13px] font-semibold">{me.full_name || me.email}</div>
            <div className="text-[10px] text-white/50">{roleLabel(me.role)}</div>
          </button>
        </div>
      </div>

      {/* page row for the current module */}
      <div className="hidden md:block">
        <div className="mx-auto flex max-w-6xl gap-1 px-4 py-1.5">
          {pages.map(p => (
            <NavLink key={p.to} to={p.to} end={p.end}
              className={({ isActive }) =>
                'rounded px-2.5 py-1 text-[13px] ' +
                (isActive ? 'bg-white/15 font-semibold' : 'text-white/60 hover:text-white')}>
              {p.label}
            </NavLink>
          ))}
        </div>
      </div>

      {open && (
        <div className="border-t border-white/10 px-4 py-3">
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

function BottomNav({ me, can }) {
  const { pathname } = useLocation()
  const current = moduleFor(pathname)
  const pages = visiblePages(MODULES.find(m => m.key === current), can).slice(0, 5)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-white md:hidden">
      {pages.map(p => (
        <NavLink key={p.to} to={p.to} end={p.end}
          className={({ isActive }) =>
            'flex-1 py-3 text-center text-[11px] font-semibold ' +
            (isActive ? 'text-gold' : 'text-slate2')}>
          {p.short}
        </NavLink>
      ))}
    </nav>
  )
}
