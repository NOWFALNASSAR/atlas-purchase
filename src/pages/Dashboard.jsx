import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, lakh, inr, dt, statusStyle, num } from '../lib/db'
import { useMe, useEntity, useCan } from '../App'
import EntityBar from '../components/EntityBar'

/* ==================================================================
   THE LANDING PAGE

   This is the first screen after signing in, and for most staff it is
   the only screen they need to look at each morning.

   It is assembled from module sections. A section appears only if the
   person has the right to that module, so a Purchase Manager sees the
   purchase section and nothing else, while the MD sees all of them and
   can click through to any detail page.

   Each section fetches its OWN data, and only when it is shown. A
   purchase executive therefore makes one query, not five. On shop wifi
   that is the difference between a dashboard and a wait.
   ================================================================== */

export default function Dashboard() {
  const me = useMe()
  const can = useCan()
  const { entityId, entities } = useEntity()

  const show = {
    purchase: can('po.view'),
    stock:    can('inventory.view') || can('godown.view') || can('transfers.view'),
    sales:    can('sales.view'),
    tasks:    can('tasks.view'),
    setup:    can('users.manage') || can('roles.manage') || can('settings.manage')
  }

  const small = [
    show.stock && <StockSection key="stock" can={can} />,
    show.sales && <SalesSection key="sales" can={can} entityId={entityId} />,
    show.tasks && <TasksSection key="tasks" />
  ].filter(Boolean)

  const nothing = !Object.values(show).some(Boolean)

  return (
    <div className="page page-xl space-y-7">

      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">
              {greeting()}{firstName(me) ? ', ' + firstName(me) : ''}
            </h1>
            <p className="mt-0.5 text-sm text-slate2">
              {new Date().toLocaleDateString('en-IN',
                { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {entities.length > 1 && (entityId === 'mixed'
                ? ' · all entities'
                : ' · ' + (entities.find(e => e.id === entityId)?.name || ''))}
            </p>
          </div>
          <EntityBar />
        </div>
      </header>

      {can('po.approve') && <ApprovalsBand me={me} entityId={entityId} />}

      {show.purchase && <PurchaseSection me={me} entityId={entityId} can={can} />}

      {small.length > 0 && (
        <div className={'grid gap-6 ' + (small.length > 1 ? 'xl:grid-cols-2' : '')}>
          {small}
        </div>
      )}

      {show.setup && <SetupSection can={can} />}

      {nothing && (
        <div className="card p-8 text-center">
          <div className="mb-1.5 text-base font-semibold">Nothing switched on yet</div>
          <p className="text-sm text-slate2">
            Your account is active but no rights have been given to it. Ask the
            admin to set your role under Masters → Users.
          </p>
        </div>
      )}
    </div>
  )
}

/* ==================================================================
   1. WAITING FOR YOU
   Above every section, because an approval sitting for two days is
   the most expensive thing on this page.
   ================================================================== */

function ApprovalsBand({ me, entityId }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let live = true
    let q = db.from('purchase_orders')
      .select('id,po_no,total_purchase,created_at,pending_role,suppliers(name),entities(code)')
      .eq('status', 'pending')
      .order('created_at')
      .limit(8)
    if (entityId && entityId !== 'mixed') q = q.eq('entity_id', entityId)

    q.then(({ data }) => {
      if (!live) return
      setRows((data || []).filter(p => me.role === 'admin' || p.pending_role === me.role))
    })
    return () => { live = false }
  }, [entityId, me.id, me.role])

  if (rows === null || rows.length === 0) return null

  const total = rows.reduce((s, p) => s + Number(p.total_purchase || 0), 0)

  return (
    <section className="card overflow-hidden border-gold/50">
      <div className="flex items-center justify-between gap-3 bg-gold2 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-gold">
            {rows.length} order{rows.length > 1 ? 's' : ''} waiting for your approval
          </div>
          <div className="text-xs text-gold/80">{lakh(total)} held up</div>
        </div>
        <Link to="/orders?status=pending" className="btn-ghost btn-sm">See all</Link>
      </div>

      <ul className="divide-y divide-line">
        {rows.map(p => (
          <li key={p.id}>
            <Link to={'/orders/' + p.id}
              className="flex items-center gap-3 px-4 py-3 transition hover:bg-paper">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{p.suppliers?.name || 'Supplier'}</div>
                <div className="text-xs text-slate2">
                  {p.po_no} · raised {dt(p.created_at)}
                  {ageDays(p.created_at) >= 2 && (
                    <span className="ml-1.5 font-semibold text-bad">
                      {ageDays(p.created_at)} days old
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right text-sm font-semibold">{lakh(p.total_purchase)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ==================================================================
   2. PURCHASE
   ================================================================== */

function PurchaseSection({ me, entityId, can }) {
  const [state, setState] = useState({
    loading: true, counts: {}, monthValue: 0, monthCount: 0, mine: [], byEntity: []
  })

  useEffect(() => {
    let live = true
    const first = new Date(); first.setDate(1); first.setHours(0, 0, 0, 0)

    let q = db.from('purchase_orders')
      .select('id,po_no,status,total_purchase,created_at,created_by,entity_id,suppliers(name),entities(name)')
      .order('created_at', { ascending: false })
      .limit(400)
    if (entityId && entityId !== 'mixed') q = q.eq('entity_id', entityId)

    q.then(({ data, error }) => {
      if (!live) return
      if (error) return setState({ loading: false, error: true })

      const list = data || []
      const counts = {}
      list.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1 })

      const live_ = list.filter(p =>
        ['approved', 'sent', 'confirmed', 'partial', 'closed'].includes(p.status) &&
        new Date(p.created_at) >= first)

      const byEntity = {}
      live_.forEach(p => {
        const k = p.entities?.name || 'Unassigned'
        byEntity[k] = (byEntity[k] || 0) + Number(p.total_purchase || 0)
      })

      setState({
        loading: false,
        counts,
        monthValue: live_.reduce((s, p) => s + Number(p.total_purchase || 0), 0),
        monthCount: live_.length,
        mine: list.filter(p => p.created_by === me.id).slice(0, 5),
        byEntity: Object.entries(byEntity).sort((a, b) => b[1] - a[1])
      })
    })
    return () => { live = false }
  }, [entityId, me.id])

  return (
    <Section title="Purchase" to="/purchase" toLabel="Purchase dashboard" loading={state.loading}>
      {() => state.error ? <Broken what="orders" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Bought this month" value={lakh(state.monthValue)}
              sub={state.monthCount + ' orders'} feature />
            <Stat label="Pending approval" value={state.counts?.pending || 0} to="/orders?status=pending" />
            <Stat label="Approved" value={state.counts?.approved || 0} to="/orders?status=approved" />
            <Stat label="Drafts" value={state.counts?.draft || 0} to="/orders?status=draft" />
          </div>

          {state.byEntity?.length > 1 && (
            <div className="card p-4">
              <h3 className="mb-3 text-sm font-semibold">Value by entity this month</h3>
              <ul className="space-y-2.5">
                {state.byEntity.map(([name, val]) => (
                  <li key={name}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-slate2">{name}</span>
                      <span className="font-semibold">{lakh(val)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-line2">
                      <div className="h-1.5 rounded-full bg-ink"
                        style={{ width: (state.monthValue ? (val / state.monthValue) * 100 : 0) + '%' }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Your recent orders</h3>
              {can('po.create') && (
                <Link to="/orders/new" className="text-sm font-semibold text-gold">New order</Link>
              )}
            </div>

            {!state.mine?.length ? (
              <div className="card p-6 text-center text-sm text-slate2">
                You have not raised an order yet.
                {can('po.create') && <> <Link to="/orders/new" className="font-semibold text-gold">Start one</Link>.</>}
              </div>
            ) : (
              <ul className="card divide-y divide-line">
                {state.mine.map(p => (
                  <li key={p.id}>
                    <Link to={'/orders/' + p.id}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-paper">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{p.suppliers?.name || 'Supplier'}</div>
                        <div className="text-xs text-slate2">{p.po_no || 'Draft'} · {dt(p.created_at)}</div>
                      </div>
                      <span className={'tag ' + statusStyle(p.status)}>{p.status}</span>
                      <div className="w-20 text-right text-sm font-semibold">{inr(p.total_purchase)}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}

/* ==================================================================
   3. STOCK
   ================================================================== */

function StockSection({ can }) {
  const [state, setState] = useState({
    loading: true, qty: 0, value: 0, deadValue: 0, deadCount: 0, transit: 0, top: []
  })

  useEffect(() => {
    let live = true
    Promise.all([
      db.from('v_stock_by_division').select('*'),
      db.from('v_dead_stock').select('cost_value').limit(2000),
      can('transfers.view')
        ? db.from('v_in_transit').select('doc_no').limit(500)
        : Promise.resolve({ data: [] })
    ]).then(([div, dead, transit]) => {
      if (!live) return
      if (div.error) return setState({ loading: false, error: true })

      const rows = div.data || []
      setState({
        loading: false,
        qty:   rows.reduce((s, r) => s + Number(r.qty || 0), 0),
        value: rows.reduce((s, r) => s + Number(r.cost_value || 0), 0),
        deadValue: (dead.data || []).reduce((s, r) => s + Number(r.cost_value || 0), 0),
        deadCount: (dead.data || []).length,
        transit: (transit.data || []).length,
        top: rows.sort((a, b) => Number(b.cost_value) - Number(a.cost_value)).slice(0, 4)
      })
    })
    return () => { live = false }
  }, [])

  return (
    <Section title="Stock" to="/inventory" toLabel="Open inventory" loading={state.loading}>
      {() => state.error ? <Broken what="stock" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Stock value" value={lakh(state.value)}
              sub={Math.round(state.qty || 0).toLocaleString('en-IN') + ' pieces'} feature />
            <Stat label="Held over 180 days" value={lakh(state.deadValue)}
              sub={(state.deadCount || 0) + ' lines'} to="/inventory"
              tone={state.deadValue > 0 ? 'warn' : undefined} />
          </div>

          {can('transfers.view') && state.transit > 0 && (
            <Link to="/transfers"
              className="flex items-center justify-between rounded-lg border border-bad/30 bg-bad/[.04] px-4 py-3 transition hover:bg-bad/[.07]">
              <span className="text-sm font-semibold text-bad">
                {state.transit} transfer{state.transit > 1 ? 's' : ''} sent but not received
              </span>
              <span className="text-sm font-semibold text-bad">Check</span>
            </Link>
          )}

          {state.top?.length > 0 && (
            <ul className="card divide-y divide-line">
              {state.top.map(r => (
                <li key={r.label} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
                  <span className="text-xs text-slate2">
                    {Math.round(Number(r.qty || 0)).toLocaleString('en-IN')} pcs
                  </span>
                  <span className="w-20 text-right text-sm font-semibold">{lakh(r.cost_value)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

/* ==================================================================
   4. SALES
   ================================================================== */

function SalesSection({ entityId, can }) {
  const [state, setState] = useState({
    loading: true, today: 0, yesterday: 0, bills: 0,
    mtd: 0, target: 0, pct: null, behind: []
  })

  useEffect(() => {
    let live = true
    Promise.all([
      db.from('v_sales_today').select('*'),
      can('sales.targets.view')
        ? db.from('v_target_progress').select('*')
        : Promise.resolve({ data: [] })
    ]).then(([today, target]) => {
      if (!live) return
      if (today.error) return setState({ loading: false, error: true })

      const keep = r => entityId === 'mixed' || !entityId || r.entity_id === entityId
      const t = (today.data || []).filter(keep)
      const g = (target.data || []).filter(keep)

      const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0)
      const targetTotal = sum(g, 'target')

      setState({
        loading: false,
        today:      sum(t, 'net_sales'),
        yesterday:  sum(t, 'yesterday_sales'),
        bills:      sum(t, 'bills'),
        mtd:        sum(g, 'achieved'),
        target:     targetTotal,
        pct:        targetTotal ? (sum(g, 'achieved') / targetTotal) * 100 : null,
        behind: g.filter(r => ['critical', 'attention'].includes(r.status))
                 .sort((a, b) => (a.achievement_pct || 0) - (b.achievement_pct || 0))
                 .slice(0, 4)
      })
    })
    return () => { live = false }
  }, [entityId])

  const change = state.yesterday > 0
    ? ((state.today - state.yesterday) / state.yesterday) * 100
    : null

  return (
    <Section title="Sales" to="/sales" toLabel="Sales dashboard" loading={state.loading}>
      {() => state.error ? <Broken what="sales" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Sold today" value={lakh(state.today)}
              sub={change == null ? (state.bills || 0) + ' bills'
                : `${change >= 0 ? '+' : ''}${num(change)}% on yesterday`}
              feature />
            <Stat label="Month to date" value={lakh(state.mtd)}
              sub={state.pct == null ? 'no target set' : num(state.pct) + '% of target'}
              to="/sales/targets" />
          </div>

          {state.pct != null && (
            <div className="card p-4">
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="text-slate2">Against a target of {lakh(state.target)}</span>
                <span className="font-semibold">{num(state.pct)}%</span>
              </div>
              <div className="h-2 rounded-full bg-line2">
                <div className={'h-2 rounded-full ' +
                    (state.pct >= 85 ? 'bg-good' : state.pct >= 70 ? 'bg-warn' : 'bg-bad')}
                  style={{ width: Math.min(state.pct, 100) + '%' }} />
              </div>
            </div>
          )}

          {state.behind?.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Branches behind target</h3>
              <ul className="card divide-y divide-line">
                {state.behind.map(b => (
                  <li key={b.branch_id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{b.branch_name}</span>
                    <span className="text-xs text-slate2">{lakh(b.achieved)}</span>
                    <span className={'tag ' + (b.status === 'critical' ? 'bg-bad/10 text-bad' : 'bg-warn/15 text-warn')}>
                      {b.achievement_pct ?? 0}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

/* ==================================================================
   5. TASKS
   ================================================================== */

function TasksSection() {
  const [state, setState] = useState({
    loading: true, open: 0, overdue: 0, unack: 0, urgent: []
  })

  useEffect(() => {
    let live = true
    db.from('v_tasks')
      .select('id,task_no,title,status,priority,due_date,overdue,ack_overdue,to_dept_name')
      .not('status', 'in', '("verified","cancelled")')
      .order('due_date', { nullsFirst: false })
      .limit(300)
      .then(({ data, error }) => {
        if (!live) return
        if (error) return setState({ loading: false, error: true })
        const list = data || []
        setState({
          loading: false,
          open: list.length,
          overdue: list.filter(t => t.overdue).length,
          unack: list.filter(t => t.ack_overdue).length,
          urgent: list.filter(t => t.overdue || t.priority === 'urgent').slice(0, 4)
        })
      })
    return () => { live = false }
  }, [])

  return (
    <Section title="Tasks" to="/tasks/reports" toLabel="Task reports" loading={state.loading}>
      {() => state.error ? <Broken what="tasks" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Open" value={state.open || 0} feature />
            <Stat label="Overdue" value={state.overdue || 0}
              tone={state.overdue > 0 ? 'bad' : undefined} />
            <Stat label="Not accepted" value={state.unack || 0}
              tone={state.unack > 0 ? 'warn' : undefined} />
          </div>

          {state.urgent?.length > 0 && (
            <ul className="card divide-y divide-line">
              {state.urgent.map(t => (
                <li key={t.id}>
                  <Link to={'/tasks/' + t.id}
                    className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-paper">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-slate2">
                        {t.to_dept_name}{t.due_date ? ' · due ' + dt(t.due_date) : ''}
                      </div>
                    </div>
                    {t.overdue && <span className="tag bg-bad/10 text-bad">late</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

/* ==================================================================
   6. SETUP — admin only, quiet on purpose
   ================================================================== */

function SetupSection({ can }) {
  const links = [
    can('suppliers.view') && ['/suppliers', 'Suppliers'],
    can('items.view')     && ['/items', 'Items'],
    can('users.manage')   && ['/users', 'Users'],
    can('roles.manage')   && ['/roles', 'Roles'],
    can('settings.manage')&& ['/settings', 'Settings']
  ].filter(Boolean)

  if (!links.length) return null

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate2">Setup</h2>
      <div className="flex flex-wrap gap-2">
        {links.map(([to, label]) => (
          <Link key={to} to={to} className="btn-ghost btn-sm">{label}</Link>
        ))}
      </div>
    </section>
  )
}

/* ==================================================================
   Shared pieces
   ================================================================== */

/* `children` is a FUNCTION, not JSX.

   This is deliberate. If it were plain JSX, JavaScript would build the
   whole section — reading every figure — before this component got to
   decide whether to show the skeleton instead. One unguarded number
   would then throw during loading and blank the entire app. Passing a
   function means nothing inside the section runs until the data is in. */
function Section({ title, to, toLabel, loading, children }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <Link to={to} className="text-sm font-medium text-slate2 hover:text-ink">{toLabel}</Link>
      </div>
      {loading ? <Skeleton /> : children()}
    </section>
  )
}

function Stat({ label, value, sub, to, feature, tone }) {
  const tones = {
    bad:  'border-bad/30 bg-bad/[.04]',
    warn: 'border-warn/30 bg-warn/[.05]'
  }

  const body = (
    <div className={'card h-full p-4 transition ' +
      (feature ? 'border-ink bg-ink text-white ' : tones[tone] || '') +
      (to ? ' hover:border-mute' : '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className={'mt-1 text-xl font-semibold tracking-tight lg:text-2xl ' +
        (tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : '')}>
        {value}
      </div>
      {sub && (
        <div className={'mt-0.5 text-xs ' + (feature ? 'text-white/60' : 'text-slate2')}>{sub}</div>
      )}
    </div>
  )

  return to ? <Link to={to} className="block h-full">{body}</Link> : body
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card h-[86px] animate-pulse bg-line2" />
        ))}
      </div>
      <div className="card h-24 animate-pulse bg-line2" />
    </div>
  )
}

/* Shown when a view is missing — usually because that module's SQL has
   not been run yet, or the nightly sync has not filled it. Say which,
   rather than showing zeroes that look like real figures. */
function Broken({ what }) {
  return (
    <div className="card p-5 text-sm text-slate2">
      No {what} data yet. Either the {what} tables have not been set up in
      Supabase, or nothing has been synced into them.
    </div>
  )
}

/* ---------- small helpers ---------- */

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const firstName = me => (me.full_name || '').trim().split(' ')[0] || ''

const ageDays = iso =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
