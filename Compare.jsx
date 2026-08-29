import { useEffect, useState } from 'react'
import { db, inr, dt, margin } from '../lib/db'
import Picker from '../components/Picker'

/** Pick an item → see every supplier who supplied it, and at what rate. */
export default function Compare() {
  const [items, setItems] = useState([])
  const [itemId, setItemId] = useState(null)
  const [rows, setRows] = useState([])
  const [history, setHistory] = useState([])
  const [similar, setSimilar] = useState([])

  useEffect(() => {
    db.from('items').select('*').eq('active', true).order('name')
      .then(({ data }) => setItems(data || []))
  }, [])

  useEffect(() => { if (itemId) load() }, [itemId])

  async function load() {
    const item = items.find(i => i.id === itemId)

    const [{ data: best }, { data: hist }] = await Promise.all([
      db.from('v_supplier_item_best').select('*').eq('item_id', itemId).order('best_rate'),
      db.from('v_item_rate_history').select('*').eq('item_id', itemId)
        .order('created_at', { ascending: false }).limit(15)
    ])
    setRows(best || []); setHistory(hist || [])

    if (item?.sub_category) {
      const { data: sim } = await db.from('v_item_rate_history')
        .select('item_id,item_name,supplier_name,purchase_rate,selling_rate,margin_pct,created_at')
        .neq('item_id', itemId).order('created_at', { ascending: false }).limit(200)
      const names = new Set()
      const filtered = (sim || []).filter(r => {
        if (names.has(r.item_id)) return false
        names.add(r.item_id); return true
      }).slice(0, 8)
      setSimilar(filtered)
    }
  }

  const cheapest = rows.length ? Math.min(...rows.map(r => Number(r.best_rate))) : null
  const item = items.find(i => i.id === itemId)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">Supplier comparison</h1>
        <p className="text-sm text-slate2">Before you order, check what this item has actually cost you.</p>
      </div>

      <div className="card p-4">
        <Picker label="Item" placeholder="Search item master"
          options={items.map(i => ({ id: i.id, label: i.name, sub: `${i.code}${i.model_no ? ' · ' + i.model_no : ''}` }))}
          value={itemId} onChange={setItemId} />
      </div>

      {itemId && rows.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate2">
          No purchase history for this item yet. It builds up as orders get approved.
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 text-sm font-bold">Suppliers for {item?.name}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-4 py-2 text-left">Supplier</th>
                  <th className="px-3 py-2 text-right">Best rate</th>
                  <th className="px-3 py-2 text-right">Average</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Last order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isBest = Number(r.best_rate) === cheapest
                  return (
                    <tr key={r.supplier_id} className={'border-t border-line ' + (isBest ? 'bg-good/5' : '')}>
                      <td className="px-4 py-2.5 font-medium">
                        {r.supplier_name}
                        {isBest && <span className="ml-2 tag bg-good/15 text-good">lowest</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold">{inr(r.best_rate)}</td>
                      <td className="px-3 py-2.5 text-right text-slate2">{inr(r.avg_rate)}</td>
                      <td className="px-3 py-2.5 text-right text-slate2">{r.total_qty}</td>
                      <td className="px-4 py-2.5 text-right text-slate2">{dt(r.last_purchase)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-[11px] text-slate2">
            Lowest rate is not always the best buy — check credit days and delivery record before deciding.
          </p>
        </div>
      )}

      {history.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 text-sm font-bold">Every purchase of this item</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Supplier</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-2 text-slate2">{dt(h.created_at)}</td>
                    <td className="px-3 py-2">{h.supplier_name}</td>
                    <td className="px-3 py-2 text-right">{h.qty}</td>
                    <td className="px-3 py-2 text-right font-semibold">{inr(h.purchase_rate)}</td>
                    <td className="px-4 py-2 text-right">{h.margin_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {similar.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-bold">Recently bought items, for reference</h2>
          <ul className="divide-y divide-line text-[13px]">
            {similar.map((s, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate">{s.item_name}</span>
                <span className="text-slate2">{s.supplier_name}</span>
                <span className="w-20 text-right font-semibold">{inr(s.purchase_rate)}</span>
                <span className="w-14 text-right text-slate2">{s.margin_pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
