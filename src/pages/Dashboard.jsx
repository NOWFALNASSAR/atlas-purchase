import { useEffect, useMemo, useState } from 'react'
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
    stock:    can('stock.reports') || can('godown.view') || can('transfers.view'),
    sales:    can('sales.view'),
    tasks:    can('tasks.view'),
    setup:    can('users.manage') || can('roles.manage') || can('settings.manage')
  }

  const small = [
    show.tasks && <TasksSection key="tasks" />
  ].filter(Boolean)

  const nothing = !Object.values(show).some(Boolean)

  return (
    <div className="page page-xl space-y-7">



      {/* ---------------------------------------------------------------
          The whole company, before anything else.

          One request, aggregated in the database. This is the screen
          people open most often, usually on a phone in a shop, and it
          should not be assembled from a dozen queries in the browser.
          --------------------------------------------------------------- */}
      <CompanyOverview can={can} />
      {/* The two things done every morning. They live inside Sales and
          Stock, whose sub-menus only open once you are inside the
          module — so a screen used daily was two clicks deep and
          invisible until you went looking for it. */}
      {(can('sales.import') || can('stock.import')) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {can('stock.import') && (
            <Link to="/stock/upload"
              className="card flex items-center gap-3 p-4 transition hover:border-mute">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink text-white">↑</span>
              <span>
                <span className="block text-sm font-semibold">Upload stock</span>
                <span className="block text-2xs text-slate2">
                  A shop or godown stock analysis file
                </span>
              </span>
            </Link>
          )}
          {can('sales.import') && (
            <Link to="/sales/upload"
              className="card flex items-center gap-3 p-4 transition hover:border-mute">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gold text-white">↑</span>
              <span>
                <span className="block text-sm font-semibold">Upload sales</span>
                <span className="block text-2xs text-slate2">
                  BILLWISE, ITEMWISE and SALESMANWISE
                </span>
              </span>
            </Link>
          )}
        </div>
      )}
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


/* ==================================================================
   COMPANY OVERVIEW
   ================================================================== */

function CompanyOverview({ can }) {
  const [o, setO] = useState(null)
  const [stock, setStock] = useState(null)
  const [shops, setShops] = useState([])
  const [groups, setGroups] = useState([])
  const [trend, setTrend] = useState([])
  const [shopTrend, setShopTrend] = useState([])
  const [ready, setReady] = useState(false)
  const [missing, setMissing] = useState([])

  useEffect(() => {
    let live = true
    /* Each figure loads on its own. Fetched together, one missing view
       set the whole panel to error and the page went blank below the
       header. A dashboard should lose one number at a time. */
    const grab = (view, single, set) =>
      (single ? db.from(view).select('*').maybeSingle() : db.from(view).select('*'))
        .then(({ data, error }) => {
          if (!live) return
          if (error) setMissing(m => [...new Set([...m, view])])
          else set(single ? data : (data || []))
        })

    Promise.all([
      grab('v_company_overview', true, setO),
      grab('v_stock_summary', true, setStock),
      grab('v_company_by_shop', false, setShops),
      grab('v_company_by_group', false, setGroups),
      grab('v_dash_trend', false, setTrend),
      grab('v_dash_shop_trend', false, setShopTrend)
    ]).then(() => live && setReady(true))
    return () => { live = false }
  }, [])

  const sum = (rows, k) => rows.reduce((t, r) => t + Number(r[k] || 0), 0)

  const f = useMemo(() => ({
    salesToday:  o?.sales_today ?? sum(shops, 'sales_today'),
    billsToday:  o?.bills_today ?? sum(shops, 'bills_today'),
    qtyToday:    o?.qty_today,
    marginToday: o?.margin_today,
    basketToday: o?.basket_today,
    salesMonth:  o?.sales_month ?? sum(shops, 'sales_month'),
    billsMonth:  o?.bills_month ?? sum(shops, 'bills_month'),
    marginMonth: o?.margin_month,
    marginPct:   o?.margin_pct_month,
    stockValue:  stock?.stock_value ?? sum(shops, 'stock_value'),
    over180:     stock?.value_over_180,
    pctOver180:  stock?.pct_over_180,
    neverSold:   stock?.value_never_sold,
    cover:       o?.stock_cover_days,
    days:        trend.slice(-14)
  }), [o, stock, shops, trend])

  const notes = useMemo(() => buildNotes(f, shops, groups, shopTrend),
                        [f, shops, groups, shopTrend])

  if (!ready) return <div className="card h-48 animate-pulse bg-line2" />
  if (!o && shops.length === 0) return (
    <div className="card p-5 text-sm text-slate2">
      <div className="font-semibold text-ink">No figures yet</div>
      <p className="mt-0.5">Upload a day of sales and a stock file and this fills in.</p>
    </div>
  )

  const shopTotal = sum(shops, 'sales_month')

  return (
    <section className="space-y-3">
      {missing.length > 0 && (
        <div className="card border-gold/40 bg-gold2 p-3 text-xs text-gold">
          Not loaded: {missing.join(', ')}. Everything else is shown below.
        </div>
      )}

      {notes.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
            What this says
          </div>
          <ul className="divide-y divide-line">
            {notes.map((n, i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <span className={'mt-1.5 h-2 w-2 shrink-0 rounded-full ' +
                  (n.tone === 'bad' ? 'bg-bad' : n.tone === 'good' ? 'bg-good' : 'bg-gold')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{n.text}</span>
                  {n.action && <span className="mt-0.5 block text-2xs text-slate2">{n.action}</span>}
                </span>
                {n.to && (
                  <Link to={n.to} className="shrink-0 self-center text-xs font-semibold text-slate2">
                    Look
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">The company</h2>
        <span className="text-2xs text-slate2">
          {o?.sale_date ? 'sales to ' + dt(o.sale_date) : 'no sales loaded'} · stock as last uploaded
        </span>
      </div>

      <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
        <Fig label="Sales today" value={lakh(f.salesToday)} feature />
        <Fig label="Bills" value={Number(f.billsToday || 0).toLocaleString('en-IN')} />
        <Fig label="Basket" value={f.basketToday ? inr(f.basketToday) : '—'} />
        <Fig label="Pieces" value={f.qtyToday != null ? num(f.qtyToday, 0) : '—'} />
        <Fig label="Margin" value={f.marginToday != null ? lakh(f.marginToday) : '—'}
          sub={o?.margin_pct_today != null ? num(o.margin_pct_today, 1) + '%' : null} />
        <Fig label="Shops trading"
          value={o?.shops_trading ?? shops.filter(r => r.has_sales).length} />
      </div>

      {f.days.length > 1 && (
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">Sales, last {f.days.length} days</span>
            <span className="text-2xs text-slate2">without tax</span>
          </div>
          <Bars data={f.days.map(d => ({ label: d.day, value: Number(d.sales_extax || 0) }))} />
        </div>
      )}

      <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
        <Fig label="Sales this month" value={lakh(f.salesMonth)} />
        <Fig label="Bills this month" value={Number(f.billsMonth || 0).toLocaleString('en-IN')} />
        <Fig label="Margin" value={f.marginMonth != null ? lakh(f.marginMonth) : '—'}
          sub={f.marginPct != null ? num(f.marginPct, 1) + '%' : null} />
        <Fig label="Stock value" value={lakh(f.stockValue)} />
        <Fig label="Held over 180 days" value={f.over180 != null ? lakh(f.over180) : '—'}
          sub={f.pctOver180 != null ? num(f.pctOver180, 0) + '% of stock' : null}
          tone={f.pctOver180 > 50 ? 'bad' : null} />
        <Fig label="Stock cover"
          value={f.cover ? Math.round(f.cover).toLocaleString('en-IN') + ' days' : '—'}
          tone={f.cover > 180 ? 'bad' : null} />
      </div>

      {groups.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">CC and Non CC</div>
          <div className="space-y-3 p-4">
            <Split title="Stock"
              rows={groups.map(g => ({ label: g.purchase_group, value: Number(g.stock_value || 0) }))} />
            <Split title="Sales this month"
              rows={groups.map(g => ({ label: g.purchase_group, value: Number(g.sales_month || 0) }))} />
          </div>
          <table className="w-full border-t border-line text-sm">
            <thead><tr>
              <th className="px-4 py-2 text-left">Group</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Sales</th>
              <th className="px-4 py-2 text-right">Margin %</th>
            </tr></thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.purchase_group} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium">{g.purchase_group}</td>
                  <td className="px-3 py-2.5 text-right">{lakh(g.stock_value)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{lakh(g.sales_month)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {g.margin_pct == null ? '—' : num(g.margin_pct, 1) + '%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shops.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Shop by shop</span>
            <Link to="/mis" className="text-xs text-slate2">MIS</Link>
          </div>
          <table className="w-full text-sm">
            <thead><tr>
              <th className="px-4 py-2 text-left">Shop</th>
              <th className="px-3 py-2 text-right">Today</th>
              <th className="px-3 py-2 text-right">Bills</th>
              <th className="px-3 py-2 text-right">This month</th>
              <th className="px-3 py-2 text-left">Share</th>
              <th className="px-4 py-2 text-right">Stock</th>
            </tr></thead>
            <tbody>
              {[...shops].sort((a, b) => Number(b.sales_month) - Number(a.sales_month)).map(sh => {
                const share = shopTotal ? Number(sh.sales_month || 0) / shopTotal * 100 : 0
                return (
                  <tr key={sh.shop} className="border-t border-line">
                    <td className="px-4 py-2.5 font-medium">{sh.shop}</td>
                    <td className="px-3 py-2.5 text-right">{lakh(sh.sales_today)}</td>
                    <td className="px-3 py-2.5 text-right text-slate2">{sh.bills_today || 0}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{lakh(sh.sales_month)}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line2">
                          <span className="block h-full rounded-full bg-ink"
                            style={{ width: Math.max(share, share > 0 ? 3 : 0) + '%' }} />
                        </span>
                        <span className="text-2xs text-slate2">{num(share, 0)}%</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {lakh(sh.stock_value)}
                      {!sh.has_stock && <span className="block text-2xs text-gold">no stock file</span>}
                      {!sh.has_sales && sh.has_stock &&
                        <span className="block text-2xs text-gold">no sales uploaded</span>}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-ink/20 bg-paper font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right">{lakh(f.salesToday)}</td>
                <td className="px-3 py-2.5 text-right">{f.billsToday}</td>
                <td className="px-3 py-2.5 text-right">{lakh(f.salesMonth)}</td>
                <td />
                <td className="px-4 py-2.5 text-right">{lakh(f.stockValue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {can('po.view') && (
          <Link to="/orders" className="card p-4 transition hover:border-mute">
            <div className="text-sm font-semibold">Purchase orders</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Mini label="Waiting approval" value={o?.po_pending} warn={o?.po_pending > 0} />
              <Mini label="Open" value={o?.po_open} />
              <Mini label="Part received" value={o?.po_partial} />
            </div>
            <div className="mt-2 text-2xs text-slate2">
              {lakh(o?.po_open_value)} committed on open orders
            </div>
          </Link>
        )}
        {can('tasks.view') && (
          <Link to="/tasks" className="card p-4 transition hover:border-mute">
            <div className="text-sm font-semibold">Tasks</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Mini label="Open" value={o?.tasks_open} />
              <Mini label="Overdue" value={o?.tasks_overdue} bad={o?.tasks_overdue > 0} />
              <Mini label="To check" value={o?.tasks_to_check} warn={o?.tasks_to_check > 0} />
            </div>
            {o?.tasks_disputed > 0 && (
              <div className="mt-2 text-2xs text-bad">
                {o.tasks_disputed} disputed, waiting on MD Office
              </div>
            )}
          </Link>
        )}
      </div>
    </section>
  )
}

/* ==================================================================
   WHAT THE NUMBERS SAY

   Rules over the figures already on screen. Deliberately few — a panel
   with fifteen observations is one nobody reads, and a wrong one costs
   more trust than a right one earns. Each says what was measured and
   what to do about it, never just that something is bad.
   ================================================================== */

function buildNotes(f, shops, groups, shopTrend) {
  const n = []

  if (f.pctOver180 > 60 && f.over180 > 0) {
    n.push({ tone: 'bad',
      text: `${lakh(f.over180)} of stock has been sitting more than six months — ` +
            `${num(f.pctOver180, 0)}% of everything you hold.`,
      action: 'Most of the money is in goods that are not moving.',
      to: '/stock/reports' })
  }

  if (f.neverSold > 0 && f.stockValue > 0 && f.neverSold / f.stockValue > 0.2) {
    n.push({ tone: 'bad',
      text: `${lakh(f.neverSold)} of stock has never sold a single piece — ` +
            `${num(f.neverSold / f.stockValue * 100, 0)}% of what you hold.`,
      action: 'Lines that arrived and never moved at all.',
      to: '/stock/reports' })
  }

  const noStock = shops.filter(s => !s.has_stock).map(s => s.shop)
  const noSales = shops.filter(s => !s.has_sales && s.has_stock).map(s => s.shop)
  if (noStock.length) {
    n.push({ tone: 'gold',
      text: `${noStock.length} shop${noStock.length > 1 ? 's have' : ' has'} no stock ` +
            `file: ${noStock.join(', ')}.`,
      action: 'Their sales cannot be set against what they hold.',
      to: '/stock/upload' })
  }
  if (noSales.length) {
    n.push({ tone: 'gold',
      text: `${noSales.length} shop${noSales.length > 1 ? 's have' : ' has'} stock but ` +
            `no sales loaded: ${noSales.join(', ')}.`,
      action: 'Company totals are short by whatever they sold.',
      to: '/sales/upload' })
  }

  for (const s of shopTrend) {
    const now = Number(s.this_month || 0), prev = Number(s.last_month || 0)
    if (prev < 50000 || now === 0) continue
    const change = (now - prev) / prev * 100
    if (change < -25) {
      n.push({ tone: 'bad',
        text: `${s.shop} is ${num(Math.abs(change), 0)}% below last month — ` +
              `${lakh(now)} against ${lakh(prev)}.`,
        action: 'Worth looking before month end rather than after.', to: '/mis' })
    } else if (change > 25) {
      n.push({ tone: 'good',
        text: `${s.shop} is ${num(change, 0)}% ahead of last month at ${lakh(now)}.`,
        action: 'Check its stock cover — a shop selling well can run out.', to: '/mis' })
    }
  }

  if (f.marginPct != null && f.marginPct > 0 && f.marginPct < 25) {
    n.push({ tone: 'bad',
      text: `Margin this month is ${num(f.marginPct, 1)}%, under the 30 to 40% a ` +
            `garment business would expect.`,
      action: 'The below-cost report shows what sold under what it cost.',
      to: '/sales/reports' })
  }

  if (f.cover > 365) {
    n.push({ tone: 'gold',
      text: `At the current rate of selling, the stock would last ` +
            `${Math.round(f.cover / 36.5) / 10} years.`,
      action: 'Read this once a fortnight of sales is loaded — on a few days it ' +
              'swings wildly.', to: '/mis' })
  }

  return n.slice(0, 6)
}

/* ==================================================================
   CHARTS — plain SVG.

   Four simple charts are not worth several hundred kilobytes of
   charting library on shop wifi. These render before a library would
   have finished downloading.
   ================================================================== */

function Bars({ data }) {
  if (!data.length) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const w = 100 / data.length
  return (
    <div>
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="h-32 w-full">
        {data.map((d, i) => {
          const h = (d.value / max) * 30
          return <rect key={i} x={i * w + w * 0.15} y={32 - h}
            width={w * 0.7} height={Math.max(h, 0.4)} rx={w * 0.15}
            className={i === data.length - 1 ? 'fill-gold' : 'fill-ink/75'} />
        })}
      </svg>
      <div className="mt-1 flex justify-between text-2xs text-slate2">
        <span>{dt(data[0].label)}</span>
        <span className="font-semibold text-ink">
          {lakh(data[data.length - 1].value)} on {dt(data[data.length - 1].label)}
        </span>
      </div>
    </div>
  )
}

function Split({ rows, title }) {
  const total = rows.reduce((t, r) => t + r.value, 0)
  if (!total) return null
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-2xs text-slate2">{title}</span>
        <span className="text-2xs font-semibold">{lakh(total)}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-line2">
        {rows.map((r, i) => (
          <span key={r.label} className={i === 0 ? 'bg-ink' : 'bg-gold'}
            style={{ width: (r.value / total) * 100 + '%' }} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-3">
        {rows.map((r, i) => (
          <span key={r.label} className="flex items-center gap-1.5 text-2xs text-slate2">
            <span className={'h-2 w-2 rounded-sm ' + (i === 0 ? 'bg-ink' : 'bg-gold')} />
            {r.label} {num(r.value / total * 100, 0)}%
          </span>
        ))}
      </div>
    </div>
  )
}

function Fig({ label, value, sub, feature, tone }) {
  return (
    <div className={'px-4 py-3 ' + (feature ? 'bg-ink text-white' : '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className={'text-lg font-semibold ' + (tone === 'bad' ? 'text-bad' : '')}>{value}</div>
      {sub && <div className={'text-2xs ' + (feature ? 'text-white/60' : 'text-slate2')}>{sub}</div>}
    </div>
  )
}

function Mini({ label, value, warn, bad }) {
  return (
    <div>
      <div className="text-2xs text-slate2">{label}</div>
      <div className={'text-base font-semibold ' +
        (bad ? 'text-bad' : warn ? 'text-warn' : '')}>{value ?? 0}</div>
    </div>
  )
}
