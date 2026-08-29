import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import Picker from './Picker'

/**
 * Godown-first allocation.
 *   Buy 100 → 100 in godown
 *   Send 10 to PMNA, 10 to Kadakal → 80 stays in the godown
 * Leftover stock in the godown is normal, not an error.
 * Maximum 10 shops per item.
 */
export default function ShopSplit({ poId, itemId, shops, editable, totalQty = 0, onChange }) {
  const [rows, setRows] = useState([])
  const [shopId, setShopId] = useState(null)
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { load() }, [itemId])

  async function load() {
    const { data, error } = await db.from('po_item_allocations')
      .select('*, shops(code,name)').eq('po_item_id', itemId).order('created_at')
    if (error) { console.error(error); return }
    setRows(data || [])
    onChange?.((data || []).reduce((s, r) => s + r.qty, 0))
  }

  const sent   = rows.reduce((s, r) => s + r.qty, 0)
  const godown = Math.max(Number(totalQty) - sent, 0)
  const over   = sent > Number(totalQty)

  async function add() {
    if (!shopId) return alert('Choose a shop')
    const n = Number(qty)
    if (!n || n <= 0) return alert('Enter how many pieces go to this shop')
    if (n > godown) return alert(`Only ${godown} pieces left in the godown`)
    if (rows.length >= 10) return alert('Maximum 10 shops for one item')

    setBusy(true)
    const { error } = await db.from('po_item_allocations')
      .insert({ po_id: poId, po_item_id: itemId, shop_id: shopId, qty: n })
    setBusy(false)
    if (error) return alert(error.message)
    setShopId(null); setQty(''); load()
  }

  async function change(row, value) {
    const v = Number(value)
    if (!v || v <= 0) return
    const otherSent = sent - row.qty
    if (v > Number(totalQty) - otherSent)
      return alert(`Only ${Number(totalQty) - otherSent} pieces available for this shop`)
    const { error } = await db.from('po_item_allocations').update({ qty: v }).eq('id', row.id)
    if (error) return alert(error.message)
    load()
  }

  async function remove(row) {
    await db.from('po_item_allocations').delete().eq('id', row.id)
    load()
  }

  return (
    <div className="rounded-md border border-line bg-white p-3">
      {/* running balance */}
      <div className="mb-3 grid grid-cols-3 divide-x divide-line rounded-md bg-paper">
        <Box label="Bought" value={totalQty || 0} />
        <Box label="To shops" value={sent} />
        <Box label="In godown" value={godown} accent={godown > 0} />
      </div>

      {over && (
        <div className="mb-2 rounded-md bg-bad/10 px-3 py-2 text-[13px] font-semibold text-bad">
          You have sent {sent} pieces but only bought {totalQty}. Reduce a shop quantity.
        </div>
      )}

      {!totalQty && (
        <p className="mb-2 text-xs text-slate2">Enter the total quantity above first.</p>
      )}

      {/* allocated shops */}
      {rows.length > 0 && (
        <ul className="mb-3 divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2 py-1.5">
              <span className="w-5 font-mono text-[11px] text-slate2">{i + 1}</span>
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
                    className="px-1 text-base font-bold text-bad" aria-label="Remove shop">×</button>
                </>
              ) : <span className="text-[13px] font-semibold">{r.qty}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* add a shop */}
      {editable && rows.length < 10 && (
        <div className="space-y-2 rounded-md bg-paper p-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate2">
            Send to shop {rows.length + 1} of 10
          </div>
          <Picker placeholder="Choose shop"
            options={shops.filter(s => !rows.some(r => r.shop_id === s.id))
              .map(s => ({ id: s.id, label: s.name, sub: s.code }))}
            value={shopId} onChange={setShopId} />
          <div className="flex gap-2">
            <input type="number" inputMode="numeric" value={qty}
              placeholder={godown > 0 ? `Qty (max ${godown})` : 'Godown empty'}
              onChange={e => setQty(e.target.value)} disabled={godown <= 0} />
            <button type="button" className="btn-dark shrink-0"
              onClick={add} disabled={busy || godown <= 0}>Send</button>
          </div>
        </div>
      )}

      {editable && rows.length >= 10 && (
        <p className="text-xs text-slate2">All 10 shop slots used for this item.</p>
      )}
    </div>
  )
}

function Box({ label, value, accent }) {
  return (
    <div className="px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className={'text-lg font-bold ' + (accent ? 'text-gold' : '')}>{value}</div>
    </div>
  )
}
