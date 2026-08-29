import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import Picker from './Picker'

/**
 * Splits one item across shops.
 *   100 kurtis → 10 PMNA, 10 Kadakal, 10 Shop 05 ...
 * The line quantity is the sum of these rows — nobody types a total.
 * Maximum 10 shops per item.
 */
export default function ShopSplit({ poId, itemId, shops, editable, onChange }) {
  const [rows, setRows] = useState([])
  const [adding, setAdding] = useState(false)
  const [shopId, setShopId] = useState(null)
  const [qty, setQty] = useState('')

  useEffect(() => { load() }, [itemId])

  async function load() {
    const { data } = await db.from('po_item_allocations')
      .select('*, shops(code,name)').eq('po_item_id', itemId).order('created_at')
    setRows(data || [])
    onChange?.((data || []).reduce((s, r) => s + r.qty, 0))
  }

  async function add() {
    if (!shopId) return alert('Choose a shop')
    const n = Number(qty)
    if (!n || n <= 0) return alert('Enter the quantity for this shop')
    if (rows.length >= 10) return alert('Maximum 10 shops for one item')
    if (rows.some(r => r.shop_id === shopId)) return alert('That shop is already in the list')

    const { error } = await db.from('po_item_allocations')
      .insert({ po_id: poId, po_item_id: itemId, shop_id: shopId, qty: n })
    if (error) return alert(error.message)
    setShopId(null); setQty(''); setAdding(false); load()
  }

  async function change(row, n) {
    const v = Number(n)
    if (!v || v <= 0) return
    await db.from('po_item_allocations').update({ qty: v }).eq('id', row.id)
    load()
  }

  async function remove(row) {
    await db.from('po_item_allocations').delete().eq('id', row.id)
    load()
  }

  const total = rows.reduce((s, r) => s + r.qty, 0)

  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate2">
          Shop split {rows.length > 0 && `· ${rows.length}/10 shops`}
        </div>
        <div className="text-sm font-bold">{total} pcs</div>
      </div>

      {rows.length === 0 && (
        <p className="mb-2 text-xs text-slate2">
          Add each shop and how many pieces it gets. The order quantity comes from this list.
        </p>
      )}

      <ul className="mb-2 divide-y divide-line">
        {rows.map(r => (
          <li key={r.id} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px]">
              <span className="font-mono text-[11px] text-slate2">{r.shops?.code}</span>{' '}
              {r.shops?.name}
            </span>
            {editable ? (
              <>
                <input type="number" inputMode="numeric" defaultValue={r.qty}
                  onBlur={e => change(r, e.target.value)}
                  className="!w-20 !py-1 text-right !text-[13px]" />
                <button type="button" onClick={() => remove(r)}
                  className="px-1 text-sm font-bold text-bad" aria-label="Remove shop">×</button>
              </>
            ) : (
              <span className="text-[13px] font-semibold">{r.qty}</span>
            )}
          </li>
        ))}
      </ul>

      {editable && (adding ? (
        <div className="space-y-2 rounded-md bg-paper p-2">
          <Picker placeholder="Which shop?"
            options={shops.filter(s => !rows.some(r => r.shop_id === s.id))
              .map(s => ({ id: s.id, label: s.name, sub: s.code }))}
            value={shopId} onChange={setShopId} />
          <div className="flex gap-2">
            <input type="number" inputMode="numeric" value={qty} placeholder="Quantity"
              onChange={e => setQty(e.target.value)} />
            <button type="button" className="btn-dark shrink-0" onClick={add}>Add</button>
            <button type="button" className="btn-ghost shrink-0"
              onClick={() => { setAdding(false); setShopId(null); setQty('') }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} disabled={rows.length >= 10}
          className="text-xs font-semibold text-gold underline disabled:opacity-40">
          + Add shop
        </button>
      ))}
    </div>
  )
}
