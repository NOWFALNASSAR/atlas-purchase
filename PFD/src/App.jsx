import { useEffect, useState, createContext, useContext, Component } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { db, roleLabel } from './lib/db'
import NotificationBell from './components/NotificationBell'
import { InstallProvider, useInstall, isStandalone } from './components/InstallPrompt'

import Login     from './pages/Login'
import Dashboard from './pages/Dashboard'
import PurchaseDashboard from './pages/PurchaseDashboard'
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
import TaskSchedules  from './pages/TaskSchedules'
import TaskManage     from './pages/TaskManage'
import DeptPerformance from './pages/DeptPerformance'
import Eod            from './pages/Eod'
import Pfd            from './pages/Pfd'

const Ctx = createContext(null)
export const useMe = () => useContext(Ctx)

const EntityCtx = createContext(null)
export const useEntity = () => useContext(EntityCtx)

/* Rights come from the database, never from the browser. The menu below
   uses them to decide what to draw; RLS decides what is actually allowed. */
const PermCtx = createContext(() => false)
export const useCan = () => useContext(PermCtx)

/* ------------------------------------------------------------------ */
/* ICONS                                                               */
/* Drawn here rather than pulled from a library — five shapes is not    */
/* worth 300KB on a shop phone running on 2G.                           */
/* ------------------------------------------------------------------ */

const Ico = ({ d, ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" className="h-[19px] w-[19px] shrink-0" {...p}>
    {d}
  </svg>
)

const ICONS = {
  home:     <Ico d={<><path d="M4 10.6 12 4l8 6.6V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.4Z" /><path d="M9.5 20.5v-6h5v6" /></>} />,
  purchase: <Ico d={<><path d="M4 5h2l2.2 9.2a2 2 0 0 0 2 1.5h6.9a2 2 0 0 0 2-1.5L21 8H6.6" /><circle cx="10" cy="19.5" r="1.3" /><circle cx="18" cy="19.5" r="1.3" /></>} />,
  stock:    <Ico d={<><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9Z" /><path d="M3.5 7.5 12 11.6l8.5-4.1M12 11.6v8.9" /></>} />,
  sales:    <Ico d={<><path d="M3.5 20V4" /><path d="M3.5 20H21" /><path d="m7 15.5 4-4.5 3.2 3 4.8-6" /></>} />,
  tasks:    <Ico d={<><rect x="3.5" y="4" width="17" height="16.5" rx="2.5" /><path d="m8 12.3 2.6 2.6L16 9.5" /></>} />,
  masters:  <Ico d={<><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2.2" /><circle cx="8" cy="17" r="2.2" /></>} />
}

const MenuIcon  = () => <Ico d={<><path d="M4 7h16M4 12h16M4 17h16" /></>} />
const CloseIcon = () => <Ico d={<><path d="M6 6l12 12M18 6L6 18" /></>} />
const ChevIcon  = ({ open }) => (
  <Ico d={<path d={open ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6'} />} />
)

/* ------------------------------------------------------------------ */
/* MODULES                                                             */
/* ------------------------------------------------------------------ */

/* The dashboard is not part of any module. It is the landing page, it is
   open to everyone who can sign in, and it assembles itself from whatever
   the person is allowed to see. Keeping it out of Purchase means a person
   with only Sales rights no longer sees an empty Purchase menu. */
const HOME = { to: '/', label: 'Dashboard', short: 'Home', end: true }

const MODULES = [
  {
    key: 'purchase', label: 'Purchase', short: 'Buy',
    pages: [
      { to: '/purchase',    label: 'Purchase dashboard', short: 'Buy',   perm: 'po.view' },
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
      { to: '/tasks/pfd',       label: 'Plan for the day', short: 'PFD',    perm: 'tasks.pfd' },
      { to: '/tasks/eod',       label: 'End of day',      short: 'EOD',     perm: 'tasks.view' },
      { to: '/tasks/departments', label: 'Departments',   short: 'Depts',   perm: 'tasks.reports' },
      { to: '/tasks/reports',   label: 'Performance',    short: 'Reports', perm: 'tasks.reports' },
      { to: '/tasks/schedules', label: 'Recurring tasks', short: 'Repeat',  perm: 'tasks.schedules' }
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
  if (path === '/') return 'home'
  if (path.startsWith('/tasks')) return 'tasks'
  if (path.startsWith('/purchase')) return 'purchase'
  if (path.startsWith('/sales')) return 'sales'
  if (['/inventory', '/godown', '/transfers'].some(p => path.startsWith(p))) return 'stock'
  if (['/suppliers', '/items', '/users', '/roles', '/settings'].some(p => path.startsWith(p))) return 'masters'
  return 'purchase'
}

const allowed = (page, can) => !page.perm || can(page.perm)
const moduleAllowed = (mod, can) => mod.pages.some(p => allowed(p, can))
const visiblePages = (mod, can) => (mod?.pages || []).filter(p => allowed(p, can))

function titleFor(pathname) {
  if (pathname === '/') return 'Dashboard'
  const mod = MODULES.find(m => m.key === moduleFor(pathname))
  const exact = mod?.pages.find(p => p.to === pathname)
  if (exact) return exact.label
  if (pathname.startsWith('/orders/')) return 'Purchase order'
  if (pathname.startsWith('/tasks/')) return 'Task'
  return mod?.label || 'Atlas'
}

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
      .then(({ data }) => setMe({ ...data }))
  }, [session])

  useEffect(() => {
    if (!me) { setPerms(null); return }
    db.rpc('my_permissions').then(({ data, error }) => {
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
      <InstallProvider>
      <Shell me={me} can={can}>
        <Routes>
          <Route path="/"                 element={<Dashboard />} />
          <Route path="/purchase"         element={<Need p="po.view"><PurchaseDashboard /></Need>} />
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
          <Route path="/tasks/schedules"  element={<Need p="tasks.schedules"><TaskSchedules /></Need>} />
          <Route path="/tasks/pfd"        element={<Need p="tasks.pfd"><Pfd /></Need>} />
          <Route path="/tasks/eod"        element={<Need p="tasks.view"><Eod /></Need>} />
          <Route path="/tasks/departments" element={<Need p="tasks.reports"><DeptPerformance /></Need>} />
          <Route path="/tasks/:id/manage" element={<Need p="tasks.view"><TaskManage /></Need>} />
          <Route path="/tasks/:id"        element={<Need p="tasks.view"><TaskDetail /></Need>} />

          <Route path="/suppliers"        element={<Need p="suppliers.view"><Suppliers /></Need>} />
          <Route path="/items"            element={<Need p="items.view"><Items /></Need>} />
          <Route path="/users"            element={<Need p="users.manage"><Users /></Need>} />
          <Route path="/roles"            element={<Need p="roles.manage"><Roles /></Need>} />
          <Route path="/settings"         element={<Need p="settings.manage"><Settings /></Need>} />
          <Route path="*"                 element={<Navigate to="/" />} />
        </Routes>
      </Shell>
      </InstallProvider>
     </EntityCtx.Provider>
     </PermCtx.Provider>
    </Ctx.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* SHELL                                                               */
/*                                                                     */
/*   phone   header + content + bottom bar                             */
/*   tablet  icon rail  | header + content                             */
/*   laptop  full menu  | header + content                             */
/* ------------------------------------------------------------------ */

function Shell({ me, can, children }) {
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    const s = localStorage.getItem('navCollapsed')
    if (s !== null) return s === '1'
    return !window.matchMedia('(min-width: 1024px)').matches
  })
  const [drawer, setDrawer] = useState(false)

  useEffect(() => { setDrawer(false) }, [pathname])

  function toggle() {
    setCollapsed(c => { localStorage.setItem('navCollapsed', c ? '0' : '1'); return !c })
  }

  const width = collapsed ? '72px' : '244px'

  return (
    <div className="min-h-screen" style={{ '--nav': width }}>
      <Sidebar can={can} collapsed={collapsed} onToggle={toggle} />

      {drawer && <Drawer me={me} can={can} onClose={() => setDrawer(false)} />}

      <div className="transition-[padding] duration-200 md:pl-[var(--nav)]">
        <Header me={me} onMenu={() => setDrawer(true)} />
        <OfflineBar />
        <main className="px-4 py-5 pb-28 md:px-6 md:pb-8 lg:px-8 lg:py-7">
          <Boundary key={pathname}>{children}</Boundary>
        </main>
      </div>

      <BottomNav can={can} />
    </div>
  )
}

/* ---------- left sidebar (tablet and up) --------------------------- */

function Sidebar({ can, collapsed, onToggle }) {
  const { pathname } = useLocation()
  const current = moduleFor(pathname)
  const mods = MODULES.filter(m => moduleAllowed(m, can))

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden flex-col bg-ink shadow-rail
                 transition-[width] duration-200 md:flex"
      style={{ width: 'var(--nav)' }}>

      <div className={'flex h-14 items-center border-b border-white/10 ' +
        (collapsed ? 'justify-center px-2' : 'gap-2 px-4')}>
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded bg-gold text-[15px] font-bold text-white">
          A
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight text-white">Atlas</div>
            <div className="truncate text-2xs leading-tight text-white/45">Purchase & operations</div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        <NavLink to={HOME.to} end title={collapsed ? HOME.label : undefined}
          className={({ isActive }) => 'nav-item ' + (isActive ? 'nav-item-on ' : '') +
            (collapsed ? 'justify-center px-0' : '')}>
          {ICONS.home}
          {!collapsed && <span>{HOME.label}</span>}
        </NavLink>

        {!collapsed && <div className="!mt-3 border-t border-white/10 pt-2" />}

        {mods.map(m => {
          const pages = visiblePages(m, can)
          const on = current === m.key
          return (
            <div key={m.key}>
              <NavLink to={pages[0].to} title={collapsed ? m.label : undefined}
                className={'nav-item ' + (on ? 'nav-item-on ' : '') +
                  (collapsed ? 'justify-center px-0' : '')}>
                {ICONS[m.key]}
                {!collapsed && <span className="truncate">{m.label}</span>}
              </NavLink>

              {!collapsed && on && (
                <div className="mb-1 ml-[26px] mt-1 space-y-0.5 border-l border-white/10 pl-3">
                  {pages.map(p => (
                    <NavLink key={p.to} to={p.to} end={p.end}
                      className={({ isActive }) => 'nav-sub ' + (isActive ? 'nav-sub-on' : '')}>
                      {p.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="border-t border-white/10 p-2">
        <button onClick={onToggle}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className={'nav-item w-full ' + (collapsed ? 'justify-center px-0' : '')}>
          <ChevIcon open={!collapsed} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

/* ---------- phone drawer ------------------------------------------- */

function Drawer({ me, can, onClose }) {
  const { pathname } = useLocation()
  const nav = useNavigate()
  const current = moduleFor(pathname)

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-ink">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded bg-gold text-[15px] font-bold text-white">A</div>
            <span className="text-sm font-semibold text-white">Atlas</span>
          </div>
          <button onClick={onClose} className="p-1 text-white/60" aria-label="Close menu">
            <CloseIcon />
          </button>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto px-2 py-2">
          <NavLink to={HOME.to} end
            className={({ isActive }) => 'nav-item ' + (isActive ? 'nav-item-on' : '')}>
            {ICONS.home}
            {HOME.label}
          </NavLink>

          {MODULES.filter(m => moduleAllowed(m, can)).map(m => (
            <div key={m.key}>
              <div className="flex items-center gap-3 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-white/40">
                {m.label}
              </div>
              {visiblePages(m, can).map(p => (
                <NavLink key={p.to} to={p.to} end={p.end}
                  className={({ isActive }) => 'nav-item ' + (isActive ? 'nav-item-on' : '')}>
                  {p.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="safe-b border-t border-white/10 p-3">
          <div className="mb-2 px-1">
            <div className="truncate text-sm font-semibold text-white">{me.full_name || me.username}</div>
            <div className="text-2xs text-white/45">{roleLabel(me.role)}</div>
          </div>
          <button className="btn-ghost w-full"
            onClick={async () => { await db.auth.signOut(); nav('/') }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- header -------------------------------------------------- */

function Header({ me, onMenu }) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const title = titleFor(pathname)
  const moduleLabel = MODULES.find(m => m.key === moduleFor(pathname))?.label || 'Atlas'

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const initials = (me.full_name || me.username || '?')
    .split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur
                       supports-[backdrop-filter]:bg-white/80">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6 lg:px-8">
        <button onClick={onMenu} className="btn-quiet -ml-2 md:hidden" aria-label="Open menu">
          <MenuIcon />
        </button>

        {/* On a phone the sidebar is hidden, so the header names the page.
            On a tablet or laptop the sidebar already shows where you are,
            so the header gives the path instead of repeating the heading. */}
        <div className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight md:hidden">
          {title}
        </div>
        <nav className="hidden min-w-0 flex-1 items-center gap-1.5 truncate text-sm md:flex"
          aria-label="Breadcrumb">
          {pathname === '/' ? (
            <span className="font-semibold">{title}</span>
          ) : (
            <>
              <span className="text-slate2">{moduleLabel}</span>
              <span className="text-line">/</span>
              <span className="font-semibold">{title}</span>
            </>
          )}
        </nav>

        <NotificationBell />

        <div className="relative">
          <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
            className="flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 hover:bg-paper">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-2xs font-semibold text-white">
              {initials}
            </span>
            <span className="hidden text-left leading-tight lg:block">
              <span className="block max-w-[150px] truncate text-sm font-semibold">
                {me.full_name || me.username}
              </span>
              <span className="block text-2xs text-slate2">{roleLabel(me.role)}</span>
            </span>
          </button>

          {open && (
            <div onClick={e => e.stopPropagation()}
              className="absolute right-0 mt-2 w-60 overflow-hidden rounded-lg border border-line bg-white shadow-pop">
              <div className="border-b border-line px-4 py-3">
                <div className="truncate text-sm font-semibold">{me.full_name || '(no name)'}</div>
<div className="truncate text-xs text-slate2">{me.username}</div>
                <div className="mt-1.5 text-xs text-slate2">{roleLabel(me.role)}</div>
              </div>
              <InstallMenuItem />

              <button className="w-full px-4 py-3 text-left text-sm font-medium hover:bg-paper"
                onClick={async () => { await db.auth.signOut(); nav('/') }}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

/* ---------- phone bottom bar ---------------------------------------- */

function BottomNav({ can }) {
  const { pathname } = useLocation()
  const current = moduleFor(pathname)
  const mods = MODULES.filter(m => moduleAllowed(m, can))

  /* On the dashboard the bar jumps between modules. Inside a module it
     moves between that module's pages. Home is always the first tab, so
     there is one fixed way back regardless of how deep you are. */
  const items = current === 'home'
    ? [HOME, ...mods.map(m => ({ to: visiblePages(m, can)[0].to, short: m.short }))]
    : [HOME, ...visiblePages(MODULES.find(m => m.key === current), can)]

  return (
    <nav className="safe-b fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-white md:hidden">
      {items.slice(0, 5).map(p => (
        <NavLink key={p.to} to={p.to} end={p.end}
          className={({ isActive }) =>
            'relative flex-1 py-3 text-center text-2xs font-semibold ' +
            (isActive ? 'text-ink' : 'text-slate2')}>
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute inset-x-4 top-0 h-[2px] rounded-b bg-gold" />}
              {p.short}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

/* ------------------------------------------------------------------ */

function Splash({ text }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-8 text-center text-white">
      <div>
        <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-lg bg-gold text-lg font-bold">
          A
        </div>
        <div className="mb-1.5 text-lg font-semibold tracking-tight">Atlas</div>
        <div className="text-sm text-white/55">{text}</div>
      </div>
    </div>
  )
}

/* One broken figure on one page used to take down the whole app and leave
   a white screen, which tells a shop manager nothing and tells you nothing
   either. Now the page fails on its own, the menu still works, and the
   error is on screen where someone can read it out over the phone.

   Keyed on the route, so navigating away clears it. */
class Boundary extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('Page failed:', err, info) }

  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="page page-md">
        <div className="card border-bad/40 p-5">
          <h2 className="text-base font-semibold text-bad">This page could not open</h2>
          <p className="mt-1.5 text-sm text-slate2">
            The rest of the app still works — use the menu to go somewhere else.
            If it keeps happening, send this message to whoever maintains Atlas.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-paper p-3 text-xs text-ink">
            {String(this.state.err?.message || this.state.err)}
          </pre>
          <button className="btn-ghost btn-sm mt-3" onClick={() => this.setState({ err: null })}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}

/* Always here, whatever the browser decides to offer. If Chrome has
   given us a real prompt we use it; otherwise we explain what to tap. */
function InstallMenuItem() {
  const inst = useInstall()
  if (!inst || inst.installed) return null

  return (
    <button
      className="flex w-full items-center gap-2 border-b border-line px-4 py-3 text-left text-sm font-medium hover:bg-paper"
      onClick={inst.canPrompt ? inst.install : inst.openHelp}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
        <path d="M12 3.5v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
        <path d="M4.5 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
      </svg>
      Install app
    </button>
  )
}

function OfflineBar() {
  const [off, setOff] = useState(!navigator.onLine)
  useEffect(() => {
    const on = () => setOff(false), down = () => setOff(true)
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

/* Typing a URL should not get you into a page your rights do not cover.
   This is politeness, not security — RLS is the security. */
function Need({ p, children }) {
  const can = useCan()
  if (can(p)) return children
  return (
    <div className="page page-sm py-16 text-center">
      <div className="mb-2 text-base font-semibold">Not available to you</div>
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
  'insights.view':   ['manager', 'hod', 'admin'],
  'sales.import':    ['manager', 'hod', 'admin'],
  'tasks.schedules': ['admin'],
  'tasks.mrf':       ['admin', 'hod'],
  'tasks.pfd':       ['admin', 'hod', 'manager', 'executive', 'accounts'],
  'suppliers.view':  ['hod', 'admin'],
  'suppliers.edit':  ['hod', 'admin'],
  'items.view':      ['hod', 'admin'],
  'items.edit':      ['hod', 'admin'],
  'users.manage':    ['admin'],
  'roles.manage':    ['admin'],
  'settings.manage': ['admin']
}

function makeCan(me, perms) {
  if (perms === null) {
    return code => (LEGACY[code] ? LEGACY[code].includes(me.role) : true)
  }
  return code => perms.includes(code)
}
