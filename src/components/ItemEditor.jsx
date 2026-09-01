import { useEffect, useState } from 'react'
import { db, inr, margin, dt } from '../lib/db'
import Picker from './Picker'
import PhotoStrip from './PhotoStrip'
import ShopSplit from './ShopSplit'

/** One line of a purchase order. Quantity comes from the shop split. */
export default function ItemEditor({ line, index, items, shops, onSaved, onDeleted, editable, po }) {
  const [f, setF] = useState(line)
  const [open, setOpen] = useState(!line.item_name)
  const [history, setHistory] = useState([])
  const [allocQty, setAllocQty] = useState(line.qty || 0)
  const [allocs, setAllocs] = useState([])
  const [taxRates, setTaxRates] = useState([0, 5, 12, 18, 28])
  const [saving, setSaving] = useState(false)

  useEffect(() => { setF(line); setAllocQty(line.qty || 0) }, [line.id])

  useEffect(() => {
    db.from('settings').select('value').eq('key', 'tax_rates').single()
      .then(({ data }) => data?.value && setTaxRates(data.value))
  }, [])

  useEffect(() => { if (f.item_id) loadHistory(f.item_id); else setHistory([]) }, [f.item_id])
  useEffect(() => { if (f.id && !open) loadAllocs() }, [f.id, open, allocQty])

  async function loadHistory(itemId) {
    const { data } = await db.from('v_item_rate_history')
      .select('supplier_name,purchase_rate,qty,created_at')
      .eq('item_id', itemId).order('created_at', { ascending: false }).limit(5)
    setHistory(data || [])
  }

  async function loadAllocs() {
    const { data } = await db.from('po_item_allocations')
      .select('qty, shops(code)').eq('po_item_id', f.id)
    setAllocs(data || [])
  }

  const qty = Number(f.qty) || 0
  const m = margin(f.purchase_rate, f.selling_rate)
  const lineValue = qty * (Number(f.purchase_rate) || 0)
  const lineTax = Math.round(lineValue * (Number(f.tax_rate) || 0)) / 100

  function pickItem(id) {
    const it = items.find(i => i.id === id)
    setF(v => ({
      ...v, item_id: id, item_name: it.name, item_code: it.code,
      model_no: it.model_no || '', selling_rate: v.selling_rate || it.std_selling || 0
    }))
  }

  async function save() {
    if (!f.item_name) return alert('Choose an item first')
    if (!f.qty || Number(f.qty) <= 0) return alert('Enter the total quantity')
    setSaving(true)
    const payload = {
      po_id: f.po_id, item_id: f.item_id, item_name: f.item_name, item_code: f.item_code,
      model_no: f.model_no, colour: f.colour, size: f.size,
      qty: Number(f.qty) || 0,
      tax_rate: f.tax_rate === '' || f.tax_rate === undefined ? null : Number(f.tax_rate),
      purchase_rate: Number(f.purchase_rate) || 0,
      selling_rate: Number(f.selling_rate) || 0,
      remarks: f.remarks, sort_order: index
    }
    const { data, error } = f.id
      ? await db.from('po_items').update(payload).eq('id', f.id).select().single()
      : await db.from('po_items').insert(payload).select().single()
    setSaving(false)
    if (error) return alert(error.message)
    setF(data)
    onSaved(data)
    if (!f.id) return           // stay open so the shop split can be filled in
    setOpen(false)
  }

  async function del() {
    if (!confirm('Remove this item from the order?')) return
    if (f.id) await db.from('po_items').delete().eq('id', f.id)
    onDeleted(f)
  }

  /* ---------- collapsed ---------- */
  if (!open) {
    return (
      <div className="border-t border-line">
        <button type="button" onClick={() => editable && setOpen(true)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper">
          <span className="mt-0.5 font-mono text-[11px] text-slate2">{String(index + 1).padStart(2, '0')}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{f.item_name}</span>
            <span className="block text-[11px] text-slate2">
              {[f.model_no, f.colour, f.size].filter(Boolean).join(' · ')}
            </span>
            {Number(f.tax_rate) > 0 && (
              <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-[10px] font-semibold text-slate2">
                {Number(f.tax_rate)}% tax
              </span>
            )}
            {allocs.length > 0 && (
              <span className="mt-0.5 block text-[11px] text-slate2">
                {allocs.map(a => `${a.shops?.code} ${a.qty}`).join(' · ')}
              </span>
            )}
            {f.id && (() => {
              const sent = allocs.reduce((s, a) => s + a.qty, 0)
              const left = qty - sent
              return left > 0 ? (
                <span className="mt-0.5 block text-[11px] text-slate2">
                  {sent > 0 ? `${sent} to shops · ` : ''}{left} in godown
                </span>
              ) : null
            })()}
          </span>
          <span className="text-right">
            <span className="block text-sm font-semibold">{qty} × {inr(f.purchase_rate)}</span>
            <span className="block text-[11px] text-slate2">{inr(lineValue)} · {m}%</span>
          </span>
        </button>
        {f.id && <div className="px-4 pb-3"><PhotoStrip poId={f.po_id} itemId={f.id} editable={editable} /></div>}
      </div>
    )
  }

  /* ---------- expanded ---------- */
  return (
    <div className="border-t-2 border-ink bg-paper/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate2">
          Item {String(index + 1).padStart(2, '0')}
        </div>
        <button type="button" onClick={del} className="text-xs font-semibold text-bad">Remove</button>
      </div>

      <div className="space-y-3">
        <Picker label="Item" placeholder="Search item master"
          options={items.map(i => ({ id: i.id, label: i.name, sub: `${i.code}${i.model_no ? ' · ' + i.model_no : ''}` }))}
          value={f.item_id} onChange={pickItem} />

        <div className="grid grid-cols-2 gap-3">
          <div><label>Colour</label>
            <input value={f.colour || ''} onChange={e => setF(v => ({ ...v, colour: e.target.value }))} /></div>
          <div><label>Size</label>
            <input value={f.size || ''} onChange={e => setF(v => ({ ...v, size: e.target.value }))} /></div>
        </div>

        <div><label>Total quantity bought</label>
          <input type="number" inputMode="numeric" value={f.qty || ''}
            onChange={e => setF(v => ({ ...v, qty: e.target.value }))}
            placeholder="e.g. 100" /></div>

        <div className="grid grid-cols-3 gap-3">
          <div><label>Purchase ₹</label>
            <input type="number" inputMode="decimal" value={f.purchase_rate || ''}
              onChange={e => setF(v => ({ ...v, purchase_rate: e.target.value }))} /></div>
          <div><label>Selling ₹</label>
            <input type="number" inputMode="decimal" value={f.selling_rate || ''}
              onChange={e => setF(v => ({ ...v, selling_rate: e.target.value }))} /></div>
          <div><label>Tax %</label>
            <select value={f.tax_rate ?? ''}
              onChange={e => setF(v => ({ ...v, tax_rate: e.target.value }))}>
              {taxRates.map(r => <option key={r} value={r}>{r}%</option>)}
            </select></div>
        </div>

        {po?.receipt_mode === 'direct_shop' ? (
          <p className="rounded-md bg-paper px-3 py-2 text-xs text-slate2">
            Direct purchase — all {f.qty || 0} pieces go straight to the shop.
            Nothing goes through the godown.
          </p>
        ) : f.id ? (
          <>
            <ShopSplit poId={f.po_id} itemId={f.id} shops={shops} editable={editable}
                       totalQty={Number(f.qty) || 0} onChange={setAllocQty} />
            <p className="text-[11px] text-slate2">
              Send only what you want to go out now. The rest waits in the godown
              and can be sent any time from the Godown page.
            </p>
          </>
        ) : (
          <p className="text-xs text-slate2">Save the item first, then send stock to shops.</p>
        )}

        <div className="grid grid-cols-3 divide-x divide-white/15 rounded-md bg-ink text-white">
          <Mini label="Line value" value={inr(lineValue)} />
          <Mini label={`Tax ${Number(f.tax_rate) || 0}%`} value={inr(lineTax)} />
          <Mini label="Margin" value={m + '%'} warn={m < 25} />
        </div>

        {history.length > 0 && (
          <div className="card p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate2">
              What we paid before
            </div>
            <table className="w-full text-[12px]">
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-t border-line first:border-0">
                    <td className="py-1 text-slate2">{dt(h.created_at)}</td>
                    <td className="py-1">{h.supplier_name}</td>
                    <td className="py-1 text-right font-semibold">{inr(h.purchase_rate)}</td>
                    <td className="py-1 text-right text-slate2">{h.qty} pcs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div><label>Item remarks</label>
          <input value={f.remarks || ''} onChange={e => setF(v => ({ ...v, remarks: e.target.value }))}
            placeholder="Fast moving / new design / repeat order" /></div>

        {f.id && (
          <div><label>Photos</label>
            <PhotoStrip poId={f.po_id} itemId={f.id} editable /></div>
        )}

        <button type="button" className="btn-dark w-full" onClick={save} disabled={saving}>
          {saving ? 'Saving' : f.id ? 'Done' : 'Add item'}
        </button>
      </div>
    </div>
  )
}

function Mini({ label, value, warn }) {
  return (
    <div className="px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-white/60">{label}</div>
      <div className={'text-sm font-bold ' + (warn ? 'text-gold' : '')}>{value}</div>
    </div>
  )
}
