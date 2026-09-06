import { useEffect, useState } from 'react'
import { db, inr, margin, dt, num } from '../lib/db'
import Picker from './Picker'
import QuickAddItem from './QuickAddItem'
import PhotoStrip from './PhotoStrip'
import ShopSplit from './ShopSplit'

/** One line of a purchase order. Quantity comes from the shop split. */
export default function ItemEditor({ line, index, items, supplierItems = [], shops,
                                    onSaved, onDeleted, editable, po }) {
  /* Ordering from 11,000 items when a supplier sells you forty of them
     is how the wrong item gets picked. So the list is what THIS
     supplier has supplied before, with the last rate and date on each
     row. Everything else is still reachable, one tap away, because a
     first order from a supplier has no history at all. */
  const [allItems, setAllItems] = useState(false)
  /* An empty supplierItems list has two very different causes: a first
     order from this supplier, or v_supplier_items not existing. The
     picker looks identical either way — every item, unfiltered — so it
     is worth saying which. */
  const [whyAll, setWhyAll] = useState(null)
  const known = new Map(supplierItems.map(r => [String(r.item_name).toLowerCase(), r]))
  const [f, setF] = useState(line)
  const [open, setOpen] = useState(!line.item_name)
  const [history, setHistory] = useState([])
  const [allocQty, setAllocQty] = useState(line.qty || 0)
  const [allocs, setAllocs] = useState([])
  const [taxRates, setTaxRates] = useState([0, 5, 12, 18, 28])
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  /* Items created from inside this line, kept locally so the picker
     sees them without mutating the array the parent owns. */
  const [extraItems, setExtraItems] = useState([])

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
    // must look in both — an item added from this line is not in the
    // parent's list until the page reloads
    const it = [...extraItems, ...items].find(i => i.id === id)
    if (!it) return
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
        <div>
          <Picker
            label="Item"
            placeholder={allItems || supplierItems.length === 0
              ? 'Search the whole item master'
              : `Search the ${supplierItems.length} items this supplier supplies`}
            options={(() => {
              const base = [...extraItems, ...items]
              const list = (allItems || supplierItems.length === 0)
                ? base
                : base.filter(i => known.has(String(i.name).toLowerCase()))
              return list.map(i => {
                const h = known.get(String(i.name).toLowerCase())
                return {
                  id: i.id,
                  label: i.name,
                  sub: h && h.last_rate
                    ? `last ${inr(h.last_rate)}${h.last_date && h.last_date > '1900-01-01'
                        ? ' on ' + dt(h.last_date) : ''}`
                    : `${i.code}${i.model_no ? ' · ' + i.model_no : ''}`
                }
              })
            })()}
            value={f.item_id} onChange={pickItem} />

          {supplierItems.length === 0 && whyAll && (
            <p className={'mt-1.5 text-2xs ' + (whyAll === 'missing' ? 'text-bad' : 'text-slate2')}>
              {whyAll === 'missing'
                ? 'Showing every item because the supplier history is not set up yet — run 75_supplier_items.sql, then this list narrows to what this supplier actually sells you.'
                : 'Showing every item because nothing has been bought from this supplier before. Once an order goes through, this narrows to what they supply.'}
            </p>
          )}

          {supplierItems.length > 0 && (
            <button type="button" onClick={() => setAllItems(v => !v)}
              className="mt-1.5 text-xs font-medium text-slate2">
              {allItems
                ? `Show only what this supplier supplies (${supplierItems.length})`
                : 'Show the whole item master instead'}
            </button>
          )}

          {/* §14, §15, §17 — what this item cost last time, and what
              the rate being typed does against it. A buyer at a
              counter needs this before agreeing, not in a report
              afterwards. */}
          {(() => {
            const h = known.get(String(
              [...extraItems, ...items].find(i => i.id === f.item_id)?.name || ''
            ).toLowerCase())
            if (!h) return null
            const now = Number(f.purchase_rate || 0)
            const diff = h.last_rate > 0 && now > 0
              ? (now - h.last_rate) / h.last_rate * 100 : null
            return (
              <div className="mt-2 rounded-md bg-paper p-3">
                <div className="text-2xs font-semibold text-slate2">
                  Bought from this supplier before
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <Pair label="Last rate" value={h.last_rate ? inr(h.last_rate) : '—'}
                    sub={h.last_date && h.last_date > '1900-01-01' ? dt(h.last_date) : null} />
                  <Pair label="Lowest"
                    value={inr(h.lowest_arrived ?? h.lowest_ordered) || '—'} />
                  <Pair label="Highest"
                    value={inr(h.highest_arrived ?? h.highest_ordered) || '—'} />
                  <Pair label="Average"
                    value={inr(h.avg_arrived ?? h.avg_ordered) || '—'} />
                </div>
                {diff != null && Math.abs(diff) >= 1 && (
                  <div className={'mt-2 text-xs font-medium ' +
                    (diff > 0 ? 'text-bad' : 'text-good')}>
                    {diff > 0
                      ? `Rate is ${num(diff, 1)}% higher than last time`
                      : `Rate is ${num(Math.abs(diff), 1)}% lower than last time`}
                  </div>
                )}
                <div className="mt-1 text-2xs text-slate2">
                  {h.times_ordered > 0 && `${h.times_ordered} order${h.times_ordered > 1 ? 's' : ''}`}
                  {h.times_ordered > 0 && h.batches_arrived > 0 && ' · '}
                  {h.batches_arrived > 0 && `${h.batches_arrived} arrival${h.batches_arrived > 1 ? 's' : ''} in stock`}
                </div>
              </div>
            )
          })()}

          {/* §36 — adding an item must not mean abandoning the order.
              A full-width button, because at a supplier's counter this
              is tapped as often as the picker above it. */}
          <button type="button" onClick={() => setAdding(true)}
            className="btn-gold mt-2 w-full">
            + Add a new item to the master
          </button>
        </div>

        {adding && (
          <QuickAddItem
            onClose={() => setAdding(false)}
            onCreated={item => {
              setExtraItems(x => [item, ...x])
              setF(v => ({
                ...v, item_id: item.id, item_name: item.name, item_code: item.code,
                selling_rate: v.selling_rate || item.std_selling || 0
              }))
              setAdding(false)
            }} />
        )}

        {/* Colour and size are hidden. The columns are still in the
            database and anything already saved keeps its value — this
            only takes them off the form. */}

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


function Pair({ label, value, sub }) {
  return (
    <div>
      <div className="text-2xs text-slate2">{label}</div>
      <div className="font-semibold">{value}</div>
      {sub && <div className="text-2xs text-slate2">{sub}</div>}
    </div>
  )
}
