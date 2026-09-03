import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, inr, lakh, dt } from '../lib/db'
import { useMe } from '../App'

const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) }

export default function Reports() {
  const me = useMe()
  const [entities, setEntities] = useState([])
  const [types, setTypes] = useState([])
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [entity, setEntity] = useState('')
  const [type, setType] = useState('')
  const [rows, setRows] = useState([])
  const [view, setView] = useState('shop')
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    db.from('entities').select('*').order('code').then(({ data }) => {
      const allowed = me.entity_ids?.length ? data.filter(e => me.entity_ids.includes(e.id)) : data
      setEntities(allowed || [])
      if (allowed?.length === 1) setEntity(allowed[0].id)
    })
    db.from('settings').select('value').eq('key', 'purchase_types').single()
      .then(({ data }) => setTypes(data?.value || []))
  }, [])

  const statuses = includeDrafts
    ? ['draft', 'pending', 'approved', 'sent', 'confirmed', 'partial', 'closed']
    : ['approved', 'sent', 'confirmed', 'partial', 'closed']

  useEffect(() => { run() }, [from, to, entity, type, includeDrafts])

  async function run() {
    setLoading(true)
    let q = db.from('v_purchase_lines').select('*')
      .gte('created_at', from).lte('created_at', to + 'T23:59:59')
      .in('status', statuses)
    if (entity) q = q.eq('entity_id', entity)
    if (type) q = q.eq('purchase_type', type)
    const { data } = await q.limit(5000)
    setRows(data || []); setLoading(false)
  }

  const group = key => {
    const m = {}
    rows.forEach(r => {
      const k = r[key] || '—'
      m[k] = m[k] || { qty: 0, purchase: 0, sales: 0 }
      m[k].qty += r.qty
      m[k].purchase += Number(r.line_value)
      m[k].sales += Number(r.line_sales)
    })
    return Object.entries(m).sort((a, b) => b[1].purchase - a[1].purchase)
  }

  const views = {
    shop:     { label: 'By shop',     key: 'shop_name' },
    supplier: { label: 'By supplier', key: 'supplier_name' },
    type:     { label: 'By type',     key: 'purchase_type' },
    category: { label: 'By category', key: 'category_snapshot' },
    entity:   { label: 'By entity',   key: 'entity_name' },
    item:     { label: 'By item',     key: 'item_name' }
  }

  const data = group(views[view].key)
  const totalPurchase = rows.reduce((s, r) => s + Number(r.line_value), 0)
  const totalQty = rows.reduce((s, r) => s + r.qty, 0)

  function exportExcel() {
    const sheet = XLSX.utils.json_to_sheet(rows.map(r => ({
      Date: dt(r.created_at), 'PO No': r.po_no, Entity: r.entity_name,
      Type: r.purchase_type, Supplier: r.supplier_name, Shop: r.shop_name,
      'Item Code': r.item_code, Item: r.item_name, Category: r.category_snapshot,
      Qty: r.qty, 'Purchase Rate': r.purchase_rate, 'Selling Rate': r.selling_rate,
      'Tax %': r.tax_rate,
      'Purchase Value': r.line_value, 'Expected Sales': r.line_sales, 'Margin %': r.margin_pct
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Purchases')
    XLSX.writeFile(wb, `purchase-${from}-to-${to}.xlsx`)
  }

  return (
    <div className="page page-lg space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Reports</h1>
        <button className="btn-ghost" onClick={exportExcel} disabled={!rows.length}>Export Excel</button>
      </div>

      <div className="card grid gap-3 p-4 md:grid-cols-2">
        <div><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div>
          <label>Entity</label>
          <select value={entity} onChange={e => setEntity(e.target.value)}
                  disabled={entities.length === 1}>
            {entities.length > 1 && <option value="">All entities (mixed)</option>}
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label>Purchase type</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" className="!w-auto" checked={includeDrafts}
            onChange={e => setIncludeDrafts(e.target.checked)} />
          <span className="normal-case tracking-normal text-ink">
            Include drafts and orders awaiting approval
          </span>
        </label>
      </div>

      <div className="card grid grid-cols-2 divide-x divide-line">
        <div className="p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">Purchase value</div>
          <div className="text-2xl font-bold">{lakh(totalPurchase)}</div>
        </div>
        <div className="p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">Pieces</div>
          <div className="text-2xl font-bold">{totalQty.toLocaleString('en-IN')}</div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {Object.entries(views).map(([k, v]) => (
          <button key={k} onClick={() => setView(k)}
            className={'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (view === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {v.label}
          </button>
        ))}
      </div>

      {loading ? <div className="py-10 text-center text-sm text-slate2">Loading</div>
        : data.length === 0
          ? <div className="card p-8 text-center text-sm text-slate2">
              Nothing in this period. Orders appear here once approved — tick the
              box above to include drafts and pending orders.
            </div>
          : <div className="card overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                  <tr>
                    <th className="px-4 py-2 text-left">{views[view].label.replace('By ', '')}</th>
                    <th className="px-3 py-2 text-right">Pcs</th>
                    <th className="px-3 py-2 text-right">Purchase</th>
                    <th className="px-4 py-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(([name, t]) => (
                    <tr key={name} className="border-t border-line">
                      <td className="px-4 py-2.5">{name}</td>
                      <td className="px-3 py-2.5 text-right">{t.qty}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">{inr(t.purchase)}</td>
                      <td className="px-4 py-2.5 text-right text-slate2">
                        {totalPurchase ? ((t.purchase / totalPurchase) * 100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
    </div>
  )
}
