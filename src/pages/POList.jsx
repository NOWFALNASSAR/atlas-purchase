import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db, inr, dt, statusStyle } from '../lib/db'
import { useMe } from '../App'

const TABS = [
  { key: 'waiting',  label: 'For me' },
  { key: 'mine',     label: 'Mine' },
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'all',      label: 'All' }
]

export default function POList() {
  const me = useMe()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('filter') || sp.get('status') || 'mine'
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [tab])

  async function load() {
    setLoading(true)
    let sel = db.from('purchase_orders')
      .select('id,po_no,status,pending_role,purchase_type,total_purchase,total_qty,created_at,created_by,suppliers(name),entities(code)')
      .order('created_at', { ascending: false }).limit(200)

    if (tab === 'mine')     sel = sel.eq('created_by', me.id)
    if (tab === 'pending')  sel = sel.eq('status', 'pending')
    if (tab === 'approved') sel = sel.in('status', ['approved', 'sent', 'confirmed'])
    if (tab === 'draft')    sel = sel.eq('status', 'draft').eq('created_by', me.id)
    if (tab === 'waiting') {
      sel = sel.eq('status', 'pending')
      if (me.role !== 'admin') sel = sel.eq('pending_role', me.role)
    }

    const { data } = await sel
    setRows(data || []); setLoading(false)
  }

  const shown = q
    ? rows.filter(r => ((r.po_no || '') + ' ' + (r.suppliers?.name || ''))
        .toLowerCase().includes(q.toLowerCase()))
    : rows

  const total = shown.reduce((s, r) => s + Number(r.total_purchase), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Purchase orders</h1>
        <Link to="/orders/new" className="btn-gold">New order</Link>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setSp({ filter: t.key })}
            className={'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (tab === t.key ? 'bg-ink text-white' : 'bg-white text-slate2 border border-line')}>
            {t.label}
          </button>
        ))}
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO number or supplier" />

      {!loading && shown.length > 0 && (
        <div className="flex justify-between text-[12px] text-slate2">
          <span>{shown.length} orders</span>
          <span className="font-semibold">{inr(total)}</span>
        </div>
      )}

      {loading
        ? <div className="py-10 text-center text-sm text-slate2">Loading</div>
        : shown.length === 0
          ? <div className="card p-8 text-center text-sm text-slate2">Nothing here yet.</div>
          : <ul className="card divide-y divide-line">
              {shown.map(r => (
                <li key={r.id}>
                  <Link to={'/orders/' + r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{r.suppliers?.name}</div>
                      <div className="font-mono text-[11px] text-slate2">
                        {r.po_no || 'Draft'} · {r.entities?.code} · {dt(r.created_at)}
                      </div>
                      {r.purchase_type && (
                        <span className="mt-0.5 inline-block rounded bg-paper px-1.5 py-0.5 text-[10px] font-semibold text-slate2">
                          {r.purchase_type}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{inr(r.total_purchase)}</div>
                      <div className="text-[11px] text-slate2">{r.total_qty} pcs</div>
                    </div>
                    <span className={'tag ' + statusStyle(r.status)}>{r.status}</span>
                  </Link>
                </li>
              ))}
            </ul>}
    </div>
  )
}
