import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, lakh, inr, dt, num, statusStyle } from '../lib/db'
import { useEntity } from '../App'
import EntityBar from '../components/EntityBar'

/* ==================================================================
   PURCHASE DASHBOARD

   The home page carries a short purchase summary. This is the full
   picture, for when somebody wants to actually look: where the money
   went, who it went to, what is stuck and with whom.
   ================================================================== */

const MONTHS = [1, 3, 6, 12]

export default function PurchaseDashboard() {
  const { entityId, entities } = useEntity()
  const [months, setMonths] = useState(3)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  useEffect(() => { if (entityId) load() }, [entityId, months])

  async function load() {
    setLoading(true)
    const from = new Date()
    from.setMonth(from.getMonth() - months)
    from.setHours(0, 0, 0, 0)

    let q = db.from('purchase_orders')
      .select('id,po_no,status,pending_role,total_purchase,created_at,created_by,entity_id,' +
              'suppliers(name),entities(code,name),profiles:created_by(full_name)')
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: false })
      .limit(2000)
    if (entityId && entityId !== 'mixed') q = q.eq('entity_id', entityId)

    const { data, error } = await q
    if (error) { setFailed(error.message); setLoading(false); return }
    setRows(data || []); setFailed(null); setLoading(false)
  }

  const live = useMemo(() =>
    rows.filter(p => ['approved', 'sent', 'confirmed', 'partial', 'closed'].includes(p.status)),
    [rows])

  const value = useMemo(() =>
    live.reduce((s, p) => s + Number(p.total_purchase || 0), 0), [live])

  const counts = useMemo(() => {
    const c = {}
    rows.forEach(p => { c[p.status] = (c[p.status] || 0) + 1 })
    return c
  }, [rows])

  /* by month */
  const byMonth = useMemo(() => {
    const m = {}
    live.forEach(p => {
      const d = new Date(p.created_at)
      const k = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
      m[k] = (m[k] || 0) + Number(p.total_purchase || 0)
    })
    return Object.entries(m).reverse()
  }, [live])

  /* top suppliers */
  const bySupplier = useMemo(() => {
    const m = {}
    live.forEach(p => {
      const k = p.suppliers?.name || 'Unnamed'
      if (!m[k]) m[k] = { value: 0, orders: 0 }
      m[k].value += Number(p.total_purchase || 0)
      m[k].orders += 1
    })
    return Object.entries(m).sort((a, b) => b[1].value - a[1].value).slice(0, 10)
  }, [live])

  /* stuck approvals, oldest first */
  const stuck = useMemo(() =>
    rows.filter(p => p.status === 'pending')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .slice(0, 12),
    [rows])

  const stuckValue = stuck.reduce((s, p) => s + Number(p.total_purchase || 0), 0)

  /* who is raising the orders */
  const byPerson = useMemo(() => {
    const m = {}
    rows.forEach(p => {
      const k = p.profiles?.full_name || 'Unknown'
      if (!m[k]) m[k] = { orders: 0, value: 0 }
      m[k].orders += 1
      m[k].value += Number(p.total_purchase || 0)
    })
    return Object.entries(m).sort((a, b) => b[1].value - a[1].value).slice(0, 8)
  }, [rows])

  const maxMonth = Math.max(...byMonth.map(([, v]) => v), 1)

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load purchase orders</div>
        <div className="mt-0.5">{failed}</div>
        <button className="btn-ghost btn-sm mt-3" onClick={load}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Purchase</h1>
          <p className="text-sm text-slate2">
            {entities.length > 1 && (entityId === 'mixed'
              ? 'All entities · '
              : (entities.find(e => e.id === entityId)?.name || '') + ' · ')}
            last {months} month{months > 1 ? 's' : ''}
          </p>
        </div>
        <EntityBar />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {MONTHS.map(m => (
          <button key={m} onClick={() => setMonths(m)}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (months === m ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {m === 12 ? '1 year' : `${m} month${m > 1 ? 's' : ''}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="card h-28 animate-pulse bg-line2" />
          <div className="card h-64 animate-pulse bg-line2" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Bought" value={lakh(value)} sub={live.length + ' orders'} feature />
            <Stat label="Awaiting approval" value={counts.pending || 0}
              sub={stuckValue ? lakh(stuckValue) + ' held' : null}
              to="/orders?status=pending" tone={counts.pending ? 'warn' : undefined} />
            <Stat label="Approved" value={counts.approved || 0} to="/orders?status=approved" />
            <Stat label="Rejected" value={counts.rejected || 0}
              tone={counts.rejected ? 'bad' : undefined} />
          </div>

          {/* stuck approvals */}
          {stuck.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-base font-semibold">Waiting for approval</h2>
                <Link to="/orders?status=pending" className="text-sm text-slate2">All</Link>
              </div>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 py-2.5 text-left">Supplier</th>
                      <th className="px-3 py-2.5 text-left">Order</th>
                      <th className="px-3 py-2.5 text-left">With</th>
                      <th className="px-3 py-2.5 text-right">Waiting</th>
                      <th className="px-4 py-2.5 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stuck.map(p => {
                      const days = Math.floor((Date.now() - new Date(p.created_at)) / 86400000)
                      return (
                        <tr key={p.id} className="border-t border-line">
                          <td className="px-4 py-2.5">
                            <Link to={'/orders/' + p.id} className="font-medium hover:underline">
                              {p.suppliers?.name || 'Supplier'}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-2xs text-slate2">{p.po_no}</td>
                          <td className="px-3 py-2.5 capitalize text-slate2">
                            {p.pending_role || '—'}
                          </td>
                          <td className={'px-3 py-2.5 text-right ' +
                            (days >= 3 ? 'font-semibold text-bad' : '')}>
                            {days}d
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold">
                            {lakh(p.total_purchase)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            {/* by month */}
            <section>
              <h2 className="mb-2 text-base font-semibold">Month by month</h2>
              {byMonth.length === 0 ? (
                <div className="card p-6 text-center text-sm text-slate2">
                  Nothing approved in this period.
                </div>
              ) : (
                <div className="card p-4">
                  <ul className="space-y-2.5">
                    {byMonth.map(([m, v]) => (
                      <li key={m}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="text-slate2">{m}</span>
                          <span className="font-semibold">{lakh(v)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-line2">
                          <div className="h-1.5 rounded-full bg-ink"
                            style={{ width: (v / maxMonth) * 100 + '%' }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* top suppliers */}
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-base font-semibold">Where the money went</h2>
                <Link to="/compare" className="text-sm text-slate2">Rate compare</Link>
              </div>
              {bySupplier.length === 0 ? (
                <div className="card p-6 text-center text-sm text-slate2">No suppliers yet.</div>
              ) : (
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="px-4 py-2.5 text-left">Supplier</th>
                        <th className="px-3 py-2.5 text-right">Orders</th>
                        <th className="px-3 py-2.5 text-right">Value</th>
                        <th className="px-4 py-2.5 text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bySupplier.map(([name, s]) => (
                        <tr key={name} className="border-t border-line">
                          <td className="px-4 py-2.5">{name}</td>
                          <td className="px-3 py-2.5 text-right text-slate2">{s.orders}</td>
                          <td className="px-3 py-2.5 text-right font-semibold">{lakh(s.value)}</td>
                          <td className="px-4 py-2.5 text-right text-slate2">
                            {value ? num((s.value / value) * 100, 1) + '%' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* who raises the orders */}
          {byPerson.length > 0 && (
            <section>
              <h2 className="mb-2 text-base font-semibold">Who is raising the orders</h2>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 py-2.5 text-left">Person</th>
                      <th className="px-3 py-2.5 text-right">Orders</th>
                      <th className="px-4 py-2.5 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPerson.map(([name, s]) => (
                      <tr key={name} className="border-t border-line">
                        <td className="px-4 py-2.5">{name}</td>
                        <td className="px-3 py-2.5 text-right text-slate2">{s.orders}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{lakh(s.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* recent */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-base font-semibold">Latest orders</h2>
              <Link to="/orders" className="text-sm text-slate2">All orders</Link>
            </div>
            <ul className="card divide-y divide-line">
              {rows.slice(0, 10).map(p => (
                <li key={p.id}>
                  <Link to={'/orders/' + p.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {p.suppliers?.name || 'Supplier'}
                      </div>
                      <div className="text-xs text-slate2">
                        {p.po_no || 'Draft'} · {dt(p.created_at)}
                        {p.entities?.code && ` · ${p.entities.code}`}
                      </div>
                    </div>
                    <span className={'tag ' + statusStyle(p.status)}>{p.status}</span>
                    <div className="w-24 text-right text-sm font-semibold">
                      {inr(p.total_purchase)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, to, feature, tone }) {
  const tones = { bad: 'border-bad/30 bg-bad/[.04]', warn: 'border-warn/30 bg-warn/[.05]' }
  const body = (
    <div className={'card h-full p-4 ' + (feature ? 'border-ink bg-ink text-white ' : tones[tone] || '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight lg:text-2xl">{value}</div>
      {sub && <div className={'mt-0.5 text-xs ' + (feature ? 'text-white/60' : 'text-slate2')}>{sub}</div>}
    </div>
  )
  return to ? <Link to={to} className="block h-full">{body}</Link> : body
}
