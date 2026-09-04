import { useState } from 'react'
import { db } from '../lib/db'

/* ==================================================================
   ADD AN ITEM WITHOUT LEAVING THE ORDER   §36

   Half the reason item masters go stale is that adding one means
   abandoning what you were doing. Somebody typing an order at a
   supplier's counter will not navigate to Masters, create the item,
   come back and start again — they will type a near-enough name into
   whatever field accepts it.

   So the item gets created here, and is selected on the order the
   moment it saves.

   Only the fields needed to raise an order. Category, fabric and the
   rest can be filled in later on the item master by whoever owns it.
   ================================================================== */

export default function QuickAddItem({ prefill = '', onCreated, onClose }) {
  const [f, setF] = useState({
    name: prefill, code: '', category: '', model_no: '', std_selling: ''
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  /* A code is required and must be unique, but nobody at a counter
     wants to invent one. Build it from the name and make it unique. */
  function suggestCode(name) {
    const base = (name || 'ITEM').toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 2)
      .map(w => w.slice(0, 4)).join('-') || 'ITEM'
    return base + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()
  }

  async function save() {
    const name = f.name.trim()
    if (name.length < 2) return setErr('Give the item a name')

    setBusy(true); setErr(null)
    const code = f.code.trim().toUpperCase() || suggestCode(name)

    const { data, error } = await db.from('items').insert({
      name,
      code,
      category: f.category.trim() || null,
      model_no: f.model_no.trim() || null,
      std_selling: f.std_selling ? Number(f.std_selling) : null,
      active: true
    }).select().single()

    setBusy(false)

    if (error) {
      setErr(error.message.includes('duplicate') || error.code === '23505'
        ? 'That item code is already used. Change it, or leave it blank and one will be made.'
        : error.message)
      return
    }

    onCreated?.(data)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 md:items-center"
      onClick={onClose}>
      <div className="safe-b w-full max-w-md rounded-t-xl bg-white p-5 shadow-pop md:rounded-xl"
        onClick={e => e.stopPropagation()}>

        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">New item</h2>
          <button onClick={onClose} className="text-sm text-slate2">Close</button>
        </div>
        <p className="mb-4 text-xs text-slate2">
          It is added to the item master and picked for this line straight away.
        </p>

        <div className="space-y-3">
          <div>
            <label>Item name *</label>
            <input value={f.name} autoFocus
              onChange={e => setF(v => ({ ...v, name: e.target.value }))}
              placeholder="Cotton kurti, printed" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label>Code</label>
              <input value={f.code} autoCapitalize="characters"
                onChange={e => setF(v => ({ ...v, code: e.target.value }))}
                placeholder="Left blank, made for you" />
            </div>
            <div>
              <label>Model number</label>
              <input value={f.model_no}
                onChange={e => setF(v => ({ ...v, model_no: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label>Category</label>
              <input value={f.category}
                onChange={e => setF(v => ({ ...v, category: e.target.value }))}
                placeholder="Ladies" />
            </div>
            <div>
              <label>Selling rate ₹</label>
              <input type="number" inputMode="numeric" value={f.std_selling}
                onChange={e => setF(v => ({ ...v, std_selling: e.target.value }))} />
            </div>
          </div>

          {err && (
            <div className="rounded-md bg-bad/10 px-3 py-2.5 text-sm text-bad">{err}</div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button className="btn-dark flex-1" disabled={busy} onClick={save}>
            {busy ? 'Adding' : 'Add and use it'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>

        <p className="mt-3 text-2xs text-slate2">
          Category, fabric and brand can be filled in later on the item master.
        </p>
      </div>
    </div>
  )
}
