import { useEffect, useState } from 'react'
import { db, inr, margin, dt } from '../lib/db'
import Picker from './Picker'
import PhotoStrip from './PhotoStrip'

/** One editable line of a purchase order. */
export default function ItemEditor({ line, index, items, shops, supplierId, onSaved, onDeleted, editable }) {
  const [f, setF] = useState(line)
  const [open, setOpen] = useState(!line.item_name)
  const [history, setHistory] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { setF(line) }, [line.id])

  const m = margin(f.purchase_rate, f.selling_rate)
  const lineValue = (Number(f.qty) || 0) * (Number(f.purchase_rate) || 0)

  async function loadHistory(itemId) {
    if (!itemId) return setHistory([])
    const { data } = await db.from('v_item_rate_history')
      .select('supplier_name,purchase_rate,qty,created_at,po_no')
      .eq('item_id', itemId).order('created_at', { ascending: false }).limit(5)
    setHistory(data || [])
  }
  useEffect(() => { loadHistory(f.item_id) }, [f.item_id])

  function pickItem(id, opt) {
    const it = items.find(i => i.id === id)
    setF(v => ({
      ...v, item_id: id, item_name: it.name, item_code: it.code,
      model_no: it.model_no || '', selling_rate: v.selling_rate || it.std_selling || 0
    }))
  }

  async function save() {
    if (!f.item_name) return alert('Choose an item first')
    if (!f.qty || f.qty <= 0) return alert('Enter a quantity')
    setSaving(true)
    const payload = {
      po_id: f.po_id, item_id: f.item_id, item_name: f.item_name, item_code: f.item_code,
      model_no: f.model_no, colour: f.colour, size: f.size, shop_id: f.shop_id || null,
      qty: Number(f.qty), purchase_rate: Number(f.purchase_rate) || 0,
      selling_rate: Number(f.selling_rate) || 0, remarks: f.remarks, sort_order: index
    }
    const { data, error } = f.id
      ? await db.from('po_items').update(payload).eq('id', f.id).select().single()
      : await db.from('po_items').insert(payload).select().single()
    setSaving(false)
    if (error) return alert(error.message)
    setF(data); setOpen(false); onSaved(data)
  }

  async function del() {
    if (!confirm('Remove this item from the order?')) return
    if (f.id) await db.from('po_items').delete().eq('id', f.id)
    onDeleted(f)
  }

  /* ---------- collapsed summary row ---------- */
  if (!open) {
    return (
      <div className="border-t border-line">
        <button type="button" onClick={() => editable && setOpen(true)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper">
          <span className="mt-0.5 font-mono text-[11px] text-slate2">{String(index + 1).padStart(2, '0')}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{f.item_name}</span>
            <span className="block text-[11px] text-slate2">
              {[f.model_no, f.colour, f.size, shops.find(s => s.id === f.shop_id)?.code]
                .filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="text-right">
            <span className="block text-sm font-semibold">{f.qty} × {inr(f.purchase_rate)}</span>
            <span className="block text-[11px] text-slate2">{inr(lineValue)} · {m}%</span>
          </span>
        </button>
        {f.id && <div className="px-4 pb-3"><PhotoStrip poId={f.po_id} itemId={f.id} editable={editable} /></div>}
      </div>
    )
  }

  /* ---------- expanded editor ---------- */
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

        <Picker label="Shop" placeholder="Which shop is this for?"
          options={shops.map(s => ({ id: s.id, label: s.name, sub: s.code }))}
          value={f.shop_id} onChange={id => setF(v => ({ ...v, shop_id: id }))} allowEmpty />

        <div className="grid grid-cols-3 gap-3">
          <div><label>Quantity</label>
            <input type="number" inputMode="numeric" value={f.qty || ''}
              onChange={e => setF(v => ({ ...v, qty: e.target.value }))} /></div>
          <div><label>Purchase ₹</label>
            <input type="number" inputMode="decimal" value={f.purchase_rate || ''}
              onChange={e => setF(v => ({ ...v, purchase_rate: e.target.value }))} /></div>
          <div><label>Selling ₹</label>
            <input type="number" inputMode="decimal" value={f.selling_rate || ''}
              onChange={e => setF(v => ({ ...v, selling_rate: e.target.value }))} /></div>
        </div>

        <div className="flex items-center justify-between rounded-md bg-ink px-3 py-2 text-white">
          <span className="text-[11px] uppercase tracking-wider text-white/60">Line value</span>
          <span className="text-sm font-bold">{inr(lineValue)}</span>
          <span className="text-[11px] uppercase tracking-wider text-white/60">Margin</span>
          <span className={'text-sm font-bold ' + (m < 25 ? 'text-gold' : '')}>{m}%</span>
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
          <div>
            <label>Photos</label>
            <PhotoStrip poId={f.po_id} itemId={f.id} editable />
          </div>
        )}
        {!f.id && <div className="text-xs text-slate2">Save the item first, then add photos.</div>}

        <button type="button" className="btn-dark w-full" onClick={save} disabled={saving}>
          {saving ? 'Saving' : f.id ? 'Save item' : 'Add item'}
        </button>
      </div>
    </div>
  )
}
