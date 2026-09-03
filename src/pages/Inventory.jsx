import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, inr, lakh, dt, num } from '../lib/db'

/**
 * Inventory reports with drill-down.
 *
 * Pick a dimension → see totals → tap a row to filter by it → pick
 * another dimension → tap again → end at the item list. The trail
 * across the top shows where you are and lets you step back.
 *
 * Every level shows purchase value, cost value and selling value.
 */

const DIMENSIONS = [
  { key: 'division',      label: 'Division' },
  { key: 'category',      label: 'Category' },
  { key: 'sub_category',  label: 'Sub category' },
  { key: 'brand',         label: 'Brand' },
  { key: 'colour',        label: 'Colour' },
  { key: 'supplier_name', label: 'Supplier' },
  { key: 'age_bucket',    label: 'Stock age' },
  { key: 'price_band',    label: 'Price band' }
]

const RATES = [
  { key: 'purchase_value', label: 'Purchase' },
  { key: 'cost_value',     label: 'Cost' },
  { key: 'selling_value',  label: 'Selling' }
]

export default function Inventory() {
  const [dim, setDim] = useState('division')
  const [rate, setRate] = useState('cost_value')
  const [trail, setTrail] = useState([])          // [{key,label,value}]
  const [rows, setRows] = useState([])
  const [items, setItems] = useState(null)        // set when at item level
  const [detail, setDetail] = useState(null)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [dim, trail, minPrice, maxPrice])

  function baseQuery() {
    let q = db.from('v_stock_aged').select('*').gt('qty', 0)
    trail.forEach(t => { q = q.eq(t.key, t.value) })
    if (minPrice) q = q.gte('selling_rate', Number(minPrice))
    if (maxPrice) q = q.lte('selling_rate', Number(maxPrice))
    return q
  }

  // Supabase returns at most 1000 rows per request, so totals have to be
  // built from several pages. Each page needs its OWN query object — the
  // client mutates the builder, so reusing one returns overlapping rows
  // and the totals come out several times too high.
  async function fetchAll(cap = 60000) {
    const PAGE = 1000
    let from = 0, all = [], seen = new Set()
    for (;;) {
      const { data, error } = await baseQuery()
        .order('item_code', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) { console.error(error); break }
      const batch = data || []
      // belt and braces: never count the same item twice
      for (const r of batch) {
        const k = r.item_code + '|' + r.location_code
        if (!seen.has(k)) { seen.add(k); all.push(r) }
      }
      if (batch.length < PAGE || all.length >= cap) break
      from += PAGE
    }
    return all
  }

  async function load() {
    setLoading(true); setItems(null)
    const src = await fetchAll()

    const map = {}
    src.forEach(r => {
      const k = (r[dim] || '').toString().trim() || 'Not specified'
      if (!map[k]) map[k] = { label: k, items: 0, qty: 0,
                              purchase_value: 0, cost_value: 0, selling_value: 0, margin: [] }
      map[k].items += 1
      map[k].qty += Number(r.qty)
      map[k].purchase_value += Number(r.purchase_value || 0)
      map[k].cost_value += Number(r.cost_value || 0)
      map[k].selling_value += Number(r.selling_value || 0)
      if (r.margin_pct) map[k].margin.push(Number(r.margin_pct))
    })

    setRows(Object.values(map)
      .map(g => ({ ...g, avg_margin: g.margin.length
        ? +num(g.margin.reduce((a, b) => a + b, 0) / g.margin.length, 1) : 0 }))
      .sort((a, b) => b[rate] - a[rate]))
    setLoading(false)
  }

  async function showItems() {
    setLoading(true)
    const { data } = await baseQuery()
      .order('cost_value', { ascending: false }).range(0, 499)
    setItems(data || []); setLoading(false)
  }

  function drill(row) {
    setTrail(t => [...t, { key: dim, label: DIMENSIONS.find(d => d.key === dim)?.label, value: row.label }])
    const next = DIMENSIONS.find(d => !trail.some(t => t.key === d.key) && d.key !== dim)
    if (next) setDim(next.key)
  }

  function stepBack(i) {
    setTrail(t => t.slice(0, i))
    setItems(null)
  }

  async function exportExcel() {
    const data = await fetchAll()
    const sheet = XLSX.utils.json_to_sheet(data.map(r => ({
      'Item Code': r.item_code, Item: r.item_name,
      Division: r.division, Category: r.category, 'Sub Category': r.sub_category,
      Brand: r.brand, Colour: r.colour, Supplier: r.supplier_name,
      Qty: r.qty,
      'Purchase Rate': r.purchase_rate, 'Cost Rate': r.cost_rate, 'Selling Rate': r.selling_rate,
      'Purchase Value': r.purchase_value, 'Cost Value': r.cost_value, 'Selling Value': r.selling_value,
      'Margin %': r.margin_pct,
      'Last Purchase': r.last_purchase, 'Days Held': r.days_held,
      'Age': r.age_bucket, 'Price Band': r.price_band
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Stock')
    XLSX.writeFile(wb, 'godown-stock.xlsx')
  }

  const total = rows.reduce((s, r) => ({
    items: s.items + r.items, qty: s.qty + r.qty,
    purchase_value: s.purchase_value + r.purchase_value,
    cost_value: s.cost_value + r.cost_value,
    selling_value: s.selling_value + r.selling_value
  }), { items: 0, qty: 0, purchase_value: 0, cost_value: 0, selling_value: 0 })

  return (
    <div className="page page-xl space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Godown inventory</h1>
          <p className="text-sm text-slate2">
            Tap any row to go deeper. Every level shows all three rates.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={exportExcel}>Export Excel</button>
      </div>

      {/* where am I */}
      <div className="flex flex-wrap items-center gap-1 text-[13px]">
        <button onClick={() => stepBack(0)}
          className={'rounded px-2 py-1 font-semibold ' +
            (trail.length === 0 ? 'text-ink' : 'text-gold underline')}>
          All stock
        </button>
        {trail.map((t, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-slate2">›</span>
            <button onClick={() => stepBack(i + 1)}
              className={'rounded px-2 py-1 ' +
                (i === trail.length - 1 ? 'font-semibold text-ink' : 'text-gold underline')}>
              {t.value}
            </button>
          </span>
        ))}
      </div>

      {/* totals */}
      <div className="card grid grid-cols-2 divide-x divide-line md:grid-cols-5">
        <Stat label="Items" value={total.items.toLocaleString('en-IN')} />
        <Stat label="Pieces" value={Math.round(total.qty).toLocaleString('en-IN')} />
        <Stat label="Purchase" value={lakh(total.purchase_value)} />
        <Stat label="Cost" value={lakh(total.cost_value)} strong />
        <Stat label="Selling" value={lakh(total.selling_value)} />
      </div>

      {/* controls */}
      <div className="card space-y-3 p-3">
        <div>
          <label>Group by</label>
          <div className="flex flex-wrap gap-1.5">
            {DIMENSIONS.map(d => (
              <button key={d.key} onClick={() => { setDim(d.key); setItems(null) }}
                className={'rounded-md px-2.5 py-1 text-[13px] font-semibold ' +
                  (dim === d.key ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label>Selling rate from</label>
            <input type="number" inputMode="numeric" value={minPrice}
              onChange={e => setMinPrice(e.target.value)} placeholder="e.g. 500" />
          </div>
          <div>
            <label>to</label>
            <input type="number" inputMode="numeric" value={maxPrice}
              onChange={e => setMaxPrice(e.target.value)} placeholder="e.g. 1500" />
          </div>
          <div>
            <label>Sort by</label>
            <select value={rate} onChange={e => setRate(e.target.value)}>
              {RATES.map(r => <option key={r.key} value={r.key}>{r.label} value</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? <div className="py-10 text-center text-sm text-slate2">Working</div>
        : items ? (
        /* ---------- item level ---------- */
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-bold">{items.length} items</h2>
            <button className="text-xs font-semibold text-gold underline"
              onClick={() => setItems(null)}>Back to groups</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-4 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Pur</th>
                  <th className="px-2 py-2 text-right">Cost</th>
                  <th className="px-2 py-2 text-right">Sell</th>
                  <th className="px-4 py-2 text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.item_code} className="cursor-pointer border-t border-line hover:bg-paper"
                      onClick={() => setDetail(it)}>
                    <td className="px-4 py-2">
                      {it.item_name}
                      <span className="block font-mono text-[10px] text-slate2">
                        {[it.item_code, it.brand, it.colour].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-semibold">{it.qty}</td>
                    <td className="px-2 py-2 text-right text-slate2">{inr(it.purchase_rate)}</td>
                    <td className="px-2 py-2 text-right">{inr(it.cost_rate)}</td>
                    <td className="px-2 py-2 text-right">{inr(it.selling_rate)}</td>
                    <td className={'px-4 py-2 text-right text-[11px] ' +
                      (it.days_held > 180 ? 'text-bad' : 'text-slate2')}>
                      {it.days_held ?? '—'}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ---------- group level ---------- */
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-bold">
              By {DIMENSIONS.find(d => d.key === dim)?.label.toLowerCase()}
            </h2>
            <button className="text-xs font-semibold text-gold underline" onClick={showItems}>
              Show items instead
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-4 py-2 text-left">
                    {DIMENSIONS.find(d => d.key === dim)?.label}
                  </th>
                  <th className="px-2 py-2 text-right">Pcs</th>
                  <th className="px-2 py-2 text-right">Purchase</th>
                  <th className="px-2 py-2 text-right">Cost</th>
                  <th className="px-2 py-2 text-right">Selling</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label} className="cursor-pointer border-t border-line hover:bg-paper"
                      onClick={() => drill(r)}>
                    <td className="px-4 py-2.5 font-medium">
                      {r.label}
                      <span className="block text-[11px] text-slate2">{r.items} items</span>
                    </td>
                    <td className="px-2 py-2.5 text-right">{Math.round(r.qty)}</td>
                    <td className="px-2 py-2.5 text-right text-slate2">{lakh(r.purchase_value)}</td>
                    <td className="px-2 py-2.5 text-right font-semibold">{lakh(r.cost_value)}</td>
                    <td className="px-2 py-2.5 text-right">{lakh(r.selling_value)}</td>
                    <td className="px-4 py-2.5 text-right">{r.avg_margin}%</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-slate2">
                    Nothing here. Godown stock appears once the sync runs.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* item detail */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
             onClick={() => setDetail(null)}>
          <div className="safe-b max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-pop md:max-w-xl md:rounded-xl lg:p-6"
               onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="text-base font-bold">{detail.item_name}</div>
                <div className="font-mono text-[11px] text-slate2">{detail.item_code}</div>
              </div>
              <button onClick={() => setDetail(null)} className="text-sm text-slate2">Close</button>
            </div>

            <div className="mb-3 grid grid-cols-3 divide-x divide-line rounded-md bg-paper">
              <Stat label="Purchase" value={inr(detail.purchase_rate)} />
              <Stat label="Cost" value={inr(detail.cost_rate)} />
              <Stat label="Selling" value={inr(detail.selling_rate)} />
            </div>

            <dl className="space-y-1.5 text-[13px]">
              <Row k="In stock" v={`${detail.qty} pcs · ${inr(detail.cost_value)} at cost`} />
              <Row k="Margin" v={detail.margin_pct + '%'} />
              <Row k="Division" v={detail.division} />
              <Row k="Category" v={[detail.category, detail.sub_category].filter(Boolean).join(' › ')} />
              <Row k="Brand" v={detail.brand} />
              <Row k="Colour" v={detail.colour} />
              <Row k="Supplier" v={detail.supplier_name} />
              <Row k="Last purchased" v={detail.last_purchase ? dt(detail.last_purchase) : '—'} />
              <Row k="Days held" v={detail.days_held != null ? detail.days_held + ' days' : '—'} />
              <Row k="HSN" v={detail.hsn} />
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, strong }) {
  return (
    <div className={'px-3 py-3 text-center ' + (strong ? 'bg-ink/5' : '')}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  )
}

function Row({ k, v }) {
  if (!v) return null
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-1.5">
      <dt className="text-slate2">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  )
}
