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

/* ------------------------------------------------------------------ */
/* MODULES                                                             */
/* Each module is a separate area of the business with its own pages.  */
/* ------------------------------------------------------------------ */

const MODULES = [
  {
    key: 'purchase', label: 'Purchase', short: 'Buy',
    pages: [
      { to: '/',            label: 'Dashboard',      short: 'Home', end: true },
      { to: '/orders',      label: 'Purchase orders', short: 'Orders' },
      { to: '/orders/new',  label: 'New order',       short: 'New' },
      { to: '/compare',     label: 'Rate compare',    short: 'Rates' },
      { to: '/reports',     label: 'Order reports',   short: 'Reports' },
      { to: '/insights',    label: 'Insights',        short: 'Insights', roles: ['manager','hod','admin'] }
    ]
  },
  {
    key: 'stock', label: 'Stock', short: 'Stock',
    pages: [
      { to: '/inventory',  label: 'Inventory',    short: 'Stock' },
      { to: '/godown',     label: 'Godown',       short: 'Godown' },
      { to: '/transfers',  label: 'Transfers',    short: 'Transfers' }
    ]
  },
  {
    key: 'sales', label: 'Sales', short: 'Sales',
    pages: [
      { to: '/sales',           label: 'Sales dashboard', short: 'Sales' },
      { to: '/sales/branches',  label: 'Branches',        short: 'Branches' },
      { to: '/sales/salesmen',  label: 'Salesmen',        short: 'Team' },
      { to: '/sales/targets',   label: 'Targets',         short: 'Targets' },
      { to: '/sales/import',    label: 'Upload sales',    short: 'Upload',
        roles: ['manager','hod','admin'] }
    ]
  },
  {
    key: 'tasks', label: 'Tasks', short: 'Tasks',
    pages: [
      { to: '/tasks',         label: 'Tasks',       short: 'Tasks' },
      { to: '/tasks/new',     label: 'Raise task',  short: 'Raise' },
      { to: '/tasks/reports', label: 'Performance', short: 'Reports' }
    ]
  },
  {
    key: 'masters', label: 'Masters', short: 'Setup',
    roles: ['hod', 'admin'],
    pages: [
      { to: '/suppliers', label: 'Suppliers', short: 'Suppliers' },
      { to: '/items',     label: 'Items',     short: 'Items' },
      { to: '/users',     label: 'Users',     short: 'Users',    roles: ['admin'] },
      { to: '/settings',  label: 'Settings',  short: 'Settings', roles: ['admin'] }
    ]
  }
]

const moduleFor = (path) => {
  if (path.startsWith('/tasks')) return 'tasks'
  if (path.startsWith('/sales')) return 'sales'
  if (['/inventory', '/godown', '/transfers'].some(p => path.startsWith(p))) return 'stock'
  if (['/suppliers', '/items', '/users', '/settings'].some(p => path.startsWith(p))) return 'masters'
  return 'purchase'
}

const allowed = (item, role) => !item.roles || item.roles.includes(role)

/* ------------------------------------------------------------------ */

export default function App() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(null)
  const [entities, setEntities] = useState([])
  const [entityId, setEntityId] = useState('mixed')

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

  return (
    <Ctx.Provider value={me}>
     <EntityCtx.Provider value={{ entities, entityId, setEntityId: chooseEntity }}>
      <div className="min-h-screen pb-24 md:pb-0">
        <TopBar me={me} />
        <main className="mx-auto max-w-6xl px-4 py-5">
          <Routes>
            <Route path="/"                 element={<Dashboard />} />
            <Route path="/orders"           element={<POList />} />
            <Route path="/orders/new"       element={<NewPO />} />
            <Route path="/orders/:id"       element={<PODetail />} />
            <Route path="/compare"          element={<Compare />} />
            <Route path="/reports"          element={<Reports />} />
            <Route path="/insights"         element={<Insights />} />

            <Route path="/inventory"        element={<Inventory />} />
            <Route path="/godown"           element={<Godown />} />
            <Route path="/transfers"        element={<Transfers />} />

            <Route path="/sales"            element={<SalesDashboard />} />
            <Route path="/sales/branches"   element={<SalesBranches />} />
            <Route path="/sales/salesmen"   element={<Salesmen />} />
            <Route path="/sales/targets"    element={<Targets />} />
            <Route path="/sales/import"     element={<SalesImport />} />

            <Route path="/tasks"            element={<Tasks />} />
            <Route path="/tasks/new"        element={<NewTask />} />
            <Route path="/tasks/reports"    element={<TaskReports />} />
            <Route path="/tasks/:id"        element={<TaskDetail />} />

            <Route path="/suppliers"        element={<Suppliers />} />
            <Route path="/items"            element={<Items />} />
            <Route path="/users"            element={<Users />} />
            <Route path="/settings"         element={<Settings />} />
            <Route path="*"                 element={<Navigate to="/" />} />
          </Routes>
        </main>
        <BottomNav me={me} />
      </div>
     </EntityCtx.Provider>
    </Ctx.Provider>
  )
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

function TopBar({ me }) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  const mods = MODULES.filter(m => allowed(m, me.role))
  const current = moduleFor(pathname)
  const pages = (mods.find(m => m.key === current)?.pages || [])
    .filter(p => allowed(p, me.role))

  return (
    <header className="sticky top-0 z-20 bg-ink text-white">
      {/* module row */}
      <div className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2">
          <NavLink to="/" className="mr-3 text-base font-bold tracking-tight">Atlas</NavLink>

          {mods.map(m => (
            <NavLink key={m.key} to={m.pages[0].to}
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

function BottomNav({ me }) {
  const { pathname } = useLocation()
  const current = moduleFor(pathname)
  const pages = (MODULES.find(m => m.key === current)?.pages || [])
    .filter(p => allowed(p, me.role)).slice(0, 5)

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
