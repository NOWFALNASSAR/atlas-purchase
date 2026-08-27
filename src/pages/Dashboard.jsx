import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, lakh, inr, dt, statusStyle } from '../lib/db'
import { useMe } from '../App'

export default function Dashboard() {
  const me = useMe()
  const [counts, setCounts] = useState({})
  const [mine, setMine] = useState([])
  const [waiting, setWaiting] = useState([])
  const [month, setMonth] = useState({ value: 0, count: 0 })
  const [byEntity, setByEntity] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    const first = new Date(); first.setDate(1); first.setHours(0, 0, 0, 0)

    const { data: pos } = await db
      .from('purchase_orders')
      .select('id,po_no,status,pending_role,total_purchase,created_at,created_by,entity_id,suppliers(name),entities(code,name)')
      .order('created_at', { ascending: false })
      .limit(400)

    const list = pos || []
    const c = {}
    list.forEach(p => { c[p.status] = (c[p.status] || 0) + 1 })
    setCounts(c)

    setMine(list.filter(p => p.created_by === me.id).slice(0, 6))

    setWaiting(list.filter(p =>
      p.status === 'pending' && (me.role === 'admin' || p.pending_role === me.role)
    ).slice(0, 8))

    const live = list.filter(p =>
      ['approved', 'sent', 'confirmed', 'partial', 'closed'].includes(p.status) &&
      new Date(p.created_at) >= first)
    setMonth({ value: live.reduce((s, p) => s + Number(p.total_purchase), 0), count: live.length })

    const map = {}
    live.forEach(p => {
      const k = p.entities?.name || '—'
      map[k] = (map[k] || 0) + Number(p.total_purchase)
    })
    setByEntity(Object.entries(map).sort((a, b) => b[1] - a[1]))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Purchase dashboard</h1>
        <p className="text-sm text-slate2">
          {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {waiting.length > 0 && (
        <section className="card overflow-hidden border-gold">
          <div className="flex items-center justify-between bg-gold/10 px-4 py-2.5">
            <div className="text-sm font-bold text-gold">
              {waiting.length} order{waiting.length > 1 ? 's' : ''} waiting for you
            </div>
            <Link to="/orders?filter=waiting" className="text-xs font-semibold text-gold underline">
              See all
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {waiting.map(p => (
              <li key={p.id}>
                <Link to={'/orders/' + p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{p.suppliers?.name}</div>
                    <div className="font-mono text-[11px] text-slate2">{p.po_no}</div>
                  </div>
                  <div className="text-right text-sm font-bold">{lakh(p.total_purchase)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="This month" value={lakh(month.value)} sub={month.count + ' orders'} big />
        <Stat label="Pending approval" value={counts.pending || 0} to="/orders?status=pending" />
        <Stat label="Approved" value={counts.approved || 0} to="/orders?status=approved" />
        <Stat label="My drafts" value={counts.draft || 0} to="/orders?status=draft" />
      </section>

      {byEntity.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold">Purchase value by entity — this month</h2>
          <ul className="space-y-2.5">
            {byEntity.map(([name, val]) => {
              const pct = month.value ? (val / month.value) * 100 : 0
              return (
                <li key={name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate2">{name}</span>
                    <span className="font-semibold">{lakh(val)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-line">
                    <div className="h-1.5 rounded-full bg-ink" style={{ width: pct + '%' }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold">My recent orders</h2>
          <Link to="/orders/new" className="text-xs font-semibold text-gold underline">New order</Link>
        </div>
        {mine.length === 0
          ? <div className="card p-6 text-center text-sm text-slate2">
              No orders yet. <Link to="/orders/new" className="underline">Create your first purchase order</Link>.
            </div>
          : <ul className="card divide-y divide-line">
              {mine.map(p => (
                <li key={p.id}>
                  <Link to={'/orders/' + p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{p.suppliers?.name}</div>
                      <div className="text-[11px] text-slate2">
                        {p.po_no || 'Draft'} · {dt(p.created_at)}
                      </div>
                    </div>
                    <span className={'tag ' + statusStyle(p.status)}>{p.status}</span>
                    <div className="w-20 text-right text-sm font-semibold">{inr(p.total_purchase)}</div>
                  </Link>
                </li>
              ))}
            </ul>}
      </section>
    </div>
  )
}

function Stat({ label, value, sub, to, big }) {
  const body = (
    <div className={'card p-4 ' + (big ? 'bg-ink text-white border-ink' : '')}>
      <div className={'text-[11px] font-semibold uppercase tracking-wider ' +
        (big ? 'text-white/60' : 'text-slate2')}>{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className={'text-[11px] ' + (big ? 'text-white/60' : 'text-slate2')}>{sub}</div>}
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}
