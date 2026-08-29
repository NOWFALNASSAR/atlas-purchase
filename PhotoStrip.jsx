import { useEffect, useState } from 'react'
import { db, compressImage, photoUrl } from '../lib/db'

const LABELS = ['front', 'back', 'design', 'label', 'packaging', 'other']

/** Photos live in Storage; the database only keeps the path. */
export default function PhotoStrip({ poId, itemId, editable }) {
  const [rows, setRows] = useState([])
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => { load() }, [itemId])

  async function load() {
    const { data } = await db.from('po_item_photos').select('*')
      .eq('po_item_id', itemId).order('created_at')
    setRows(data || [])
    const u = {}
    for (const r of data || []) u[r.id] = await photoUrl(r.path)
    setUrls(u)
  }

  async function add(files) {
    setBusy(true)
    try {
      for (const f of Array.from(files)) {
        const blob = await compressImage(f)
        const path = `${poId}/${itemId}/${crypto.randomUUID()}.jpg`
        const { error } = await db.storage.from('po-photos')
          .upload(path, blob, { contentType: 'image/jpeg' })
        if (error) throw error
        await db.from('po_item_photos').insert({ po_id: poId, po_item_id: itemId, path })
      }
      await load()
    } catch (e) {
      alert('Photo did not upload: ' + e.message)
    }
    setBusy(false)
  }

  async function remove(r) {
    if (!confirm('Remove this photo?')) return
    await db.storage.from('po-photos').remove([r.path])
    await db.from('po_item_photos').delete().eq('id', r.id)
    load()
  }

  async function setLabel(r, label) {
    await db.from('po_item_photos').update({ label }).eq('id', r.id)
    load()
  }

  return (
    <div className="flex flex-wrap gap-2">
      {rows.map(r => (
        <div key={r.id} className="relative">
          <a href={urls[r.id]} target="_blank" rel="noreferrer">
            <img src={urls[r.id]} alt={r.label || 'item photo'}
                 className="h-20 w-20 rounded-md border border-line object-cover" />
          </a>
          {editable ? (
            <>
              <button onClick={() => remove(r)} aria-label="Remove photo"
                className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-bad text-[11px] font-bold text-white">×</button>
              <select value={r.label || ''} onChange={e => setLabel(r, e.target.value)}
                className="mt-1 !w-20 !px-1 !py-0.5 !text-[10px]">
                <option value="">label</option>
                {LABELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </>
          ) : r.label && (
            <div className="mt-1 text-center text-[10px] text-slate2">{r.label}</div>
          )}
        </div>
      ))}

      {editable && (
        <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center
                          rounded-md border border-dashed border-line bg-paper text-[11px] font-semibold text-slate2">
          {busy ? 'Uploading' : '+ Photo'}
          <input type="file" accept="image/*" multiple capture="environment" className="hidden"
                 onChange={e => e.target.files.length && add(e.target.files)} />
        </label>
      )}

      {!editable && rows.length === 0 && (
        <div className="text-xs text-slate2">No photos</div>
      )}
    </div>
  )
}
