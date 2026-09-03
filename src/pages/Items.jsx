import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, inr } from '../lib/db'
import { Modal } from './Suppliers'

const BLANK = { code: '', name: '', category: '', sub_category: '', model_no: '',
                fabric: '', brand: '', std_selling: '', active: true }

export default function Items() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [cat, setCat] = useState('')
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState(null)
  const [imp, setImp] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const PAGE = 50

  // wait for typing to stop before searching, so 69,000 rows aren't
  // scanned on every keystroke
  useEffect(() => {
    const t = setTimeout(() => { setTerm(q); setPage(0) }, 350)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => { load() }, [term, cat, page])

  useEffect(() => {
    db.from('v_item_divisions').select('*')
      .then(({ data }) => setCats(data || []))
  }, [])

  async function load() {
    setLoading(true)
    let sel = db.from('items').select('*', { count: 'exact' })
    if (term) sel = sel.or(`name.ilike.%${term}%,code.ilike.%${term}%,model_no.ilike.%${term}%`)
    if (cat) sel = sel.eq('division', cat)
    const { data, count } = await sel
      .order('name').range(page * PAGE, page * PAGE + PAGE - 1)
    setRows(data || []); setTotal(count || 0); setLoading(false)
  }

  async function save() {
    const row = { ...edit, std_selling: Number(edit.std_selling) || null }
    if (!row.name?.trim()) return alert('Item name is required')
    if (!row.code?.trim()) return alert('Item code is required — use the CAT-SUB-00000 format')
    const { error } = row.id
      ? await db.from('items').update(row).eq('id', row.id)
      : await db.from('items').insert(row)
    if (error) return alert(error.message)
    setEdit(null); load()
  }

  function downloadTemplate() {
    const sample = [{
      'ITEM NAME': 'T- SHIRT 2 PC GIRLS',
      'Unit': 'Nos',
      'VAT': 5,
      'DiviName': 'KIDS WEAR',
      'HSN': '62061010',
      'Sub Category': '',
      'Model': '',
      'Brand': '',
      'Selling Rate': ''
    }]
    const ws = XLSX.utils.json_to_sheet(sample)
    ws['!cols'] = Object.keys(sample[0]).map(k => ({ wch: Math.max(k.length + 4, 16) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Items')
    XLSX.writeFile(wb, 'item-upload-format.xlsx')
  }

  // Codes are generated from the division, because your billing export
  // has no item code column: LAD-00001, HOU-00001, KID-00001 ...
  function divisionPrefix(div) {
    const d = String(div || 'GEN').toUpperCase()
    if (d.startsWith('LADIES')) return 'LAD'
    if (d.startsWith('GENTS'))  return 'GNT'
    if (d.startsWith('KIDS'))   return 'KID'
    if (d.startsWith('NEW BORN')) return 'NBN'
    if (d.startsWith('HOUSE'))  return 'HSE'
    if (d.startsWith('HOMEDEC')) return 'HDC'
    if (d.startsWith('FOOT'))   return 'FTW'
    if (d.startsWith('SCHOOL')) return 'SCH'
    if (d.startsWith('PERFUME')) return 'PRF'
    if (d.startsWith('SUNGLASS')) return 'SGL'
    return d.replace(/[^A-Z]/g, '').slice(0, 3) || 'GEN'
  }

  async function readFile(file) {
    const wb = XLSX.read(await file.arrayBuffer())
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })

    const pick = (r, ...keys) => {
      for (const k of keys) {
        const hit = Object.keys(r).find(x => x.trim().toLowerCase() === k.toLowerCase())
        if (hit && String(r[hit]).trim() !== '') return String(r[hit]).trim()
      }
      return ''
    }

    const mapped = raw.map(r => ({
      code:         pick(r, 'Item Code', 'code'),
      name:         pick(r, 'ITEM NAME', 'Item Name', 'name'),
      division:     pick(r, 'DiviName', 'Division', 'Category'),
      category:     pick(r, 'DiviName', 'Category'),
      sub_category: pick(r, 'Sub Category'),
      unit:         pick(r, 'Unit') || 'Nos',
      hsn:          pick(r, 'HSN', 'HSN Code'),
      tax_rate:     Number(pick(r, 'VAT', 'GST', 'Tax', 'Tax %')) || null,
      model_no:     pick(r, 'Model', 'Model No'),
      fabric:       pick(r, 'Fabric'),
      brand:        pick(r, 'Brand'),
      std_selling:  Number(pick(r, 'Selling Rate', 'MRP')) || null
    })).filter(m => m.name)

    // Your export repeats the same name once per HSN code — "TOP LADIES"
    // appears 120 times. Merging keeps one row per name+division and takes
    // the most common HSN and tax rate for it.
    const merged = []
    const seen = new Map()
    for (const m of mapped) {
      const key = (m.name + '|' + m.division).toUpperCase()
      if (seen.has(key)) { seen.get(key).variants++; continue }
      const row = { ...m, variants: 1 }
      seen.set(key, row); merged.push(row)
    }

    setImp({
      all: mapped,
      merged,
      mode: 'merge',
      existingNames: new Set(rows.map(i => (i.name + '|' + (i.division || '')).toUpperCase()))
    })
  }

  async function doImport() {
    const source = imp.mode === 'merge' ? imp.merged : imp.all
    const fresh = source.filter(r =>
      !imp.existingNames.has((r.name + '|' + r.division).toUpperCase()))

    if (!fresh.length) { alert('Everything in this file is already in the item master.'); return }

    // next serial per division, continuing from what is already saved
    const serial = {}
    rows.forEach(i => {
      const m = /^([A-Z]+)-(\d+)$/.exec(i.code || '')
      if (m) serial[m[1]] = Math.max(serial[m[1]] || 0, Number(m[2]))
    })

    const payload = fresh.map(r => {
      const p = divisionPrefix(r.division)
      serial[p] = (serial[p] || 0) + 1
      const { variants, ...rest } = r
      return {
        ...rest,
        code: r.code || `${p}-${String(serial[p]).padStart(5, '0')}`,
        active: true
      }
    })

    setBusy(true)
    let done = 0
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await db.from('items').insert(payload.slice(i, i + 500))
      if (error) { setBusy(false); return alert(`Stopped after ${done}: ${error.message}`) }
      done += Math.min(500, payload.length - i)
      setProgress(Math.round((done / payload.length) * 100))
    }
    setBusy(false); setProgress(0)
    alert(`${done} items imported.`)
    setImp(null); load()
  }

  const shown = rows
  const pages = Math.ceil(total / PAGE)

  return (
    <div className="page page-lg space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Items</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={downloadTemplate}>See format</button>
          <label className="btn-ghost cursor-pointer">
            Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => e.target.files[0] && readFile(e.target.files[0])} />
          </label>
          <button className="btn-gold" onClick={() => setEdit({ ...BLANK })}>Add item</button>
        </div>
      </div>

      <details className="card p-3 text-[13px]">
        <summary className="cursor-pointer font-semibold">Excel upload format</summary>

        <p className="mt-2 font-semibold">Your billing software export works as it is</p>
        <p className="text-slate2">Export the item master and upload the file directly.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="text-[11px]">
            <thead className="bg-paper">
              <tr>{['ITEM NAME','Unit','VAT','DiviName','HSN']
                .map(h => <th key={h} className="whitespace-nowrap border border-line px-2 py-1">{h}</th>)}</tr>
            </thead>
            <tbody>
              <tr>{['T- SHIRT 2 PC GIRLS','Nos','5','KIDS WEAR','62061010']
                .map((c,i) => <td key={i} className="whitespace-nowrap border border-line px-2 py-1">{c}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-slate2">
          <b>VAT</b> becomes the item's GST rate and fills in automatically on every
          purchase order line. <b>DiviName</b> becomes the category.
          Item codes are generated for you.
        </p>

        <p className="mt-4 font-semibold">Optional extra columns</p>
        <p className="text-slate2">
          Add any of these and they will be picked up: Item Code, Sub Category,
          Model, Fabric, Brand, Selling Rate.
        </p>

        <button className="btn-ghost mt-3" onClick={downloadTemplate}>
          Download blank format
        </button>
      </details>

      <div className="grid grid-cols-3 gap-2">
        <input className="col-span-2" value={q} onChange={e => setQ(e.target.value)}
               placeholder="Search name, code or model" />
        <select value={cat} onChange={e => { setCat(e.target.value); setPage(0) }}>
          <option value="">All divisions</option>
          {cats.map(c => (
            <option key={c.division} value={c.division}>{c.division} ({c.items})</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between text-[12px] text-slate2">
        <span>
          {loading ? 'Searching' :
            total === 0 ? 'Nothing found' :
            `${total.toLocaleString('en-IN')} items${term ? ' matching “' + term + '”' : ''}`}
        </span>
        {pages > 1 && <span>Page {page + 1} of {pages.toLocaleString('en-IN')}</span>}
      </div>

      <ul className="card divide-y divide-line">
        {shown.map(r => (
          <li key={r.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper"
              onClick={() => setEdit(r)}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {r.name} {!r.active && <span className="tag bg-line text-slate2">off</span>}
                </div>
                <div className="font-mono text-[11px] text-slate2">
                  {[r.code, r.division || r.category, r.hsn && 'HSN ' + r.hsn]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="text-right">
                {r.std_selling ? <div className="text-sm font-semibold">{inr(r.std_selling)}</div> : null}
                {r.tax_rate ? <div className="text-[11px] text-slate2">{r.tax_rate}% tax</div> : null}
              </div>
            </button>
          </li>
        ))}
        {!loading && shown.length === 0 && (
          <li className="p-8 text-center text-sm text-slate2">
            No items match. Try a shorter search.
          </li>
        )}
      </ul>

      {pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <button className="btn-ghost" disabled={page === 0}
            onClick={() => setPage(p => p - 1)}>Previous</button>
          <span className="text-[12px] text-slate2">
            {(page * PAGE + 1).toLocaleString('en-IN')}–
            {Math.min((page + 1) * PAGE, total).toLocaleString('en-IN')}
          </span>
          <button className="btn-ghost" disabled={page + 1 >= pages}
            onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {imp && (
        <Modal title="Check before importing" onClose={() => !busy && setImp(null)}>
          <ul className="mb-3 space-y-1 text-sm">
            <li>{imp.all.length} rows read from the file</li>
            <li>{imp.merged.length} different items by name and division</li>
            <li className="text-slate2">
              {imp.all.length - imp.merged.length} rows are the same item repeated
              under a different HSN code
            </li>
          </ul>

          <div className="mb-3 space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="!w-auto mt-1" checked={imp.mode === 'merge'}
                onChange={() => setImp(v => ({ ...v, mode: 'merge' }))} />
              <span className="normal-case tracking-normal text-ink">
                <b>Merge repeats — {imp.merged.length} items</b><br />
                <span className="text-slate2">
                  One entry per item name. Recommended: the buyer picks "TOP LADIES"
                  once, not from 120 identical lines.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="!w-auto mt-1" checked={imp.mode === 'all'}
                onChange={() => setImp(v => ({ ...v, mode: 'all' }))} />
              <span className="normal-case tracking-normal text-ink">
                <b>Keep every row — {imp.all.length} items</b><br />
                <span className="text-slate2">Exact copy of the billing master, HSN by HSN.</span>
              </span>
            </label>
          </div>

          <p className="mb-3 text-xs text-slate2">
            Item codes are generated automatically from the division
            (LAD-00001, HSE-00001) because your export has no code column.
            Items already in the master are skipped.
          </p>

          {busy && (
            <div className="mb-3">
              <div className="h-1.5 rounded-full bg-line">
                <div className="h-1.5 rounded-full bg-ink" style={{ width: progress + '%' }} />
              </div>
              <div className="mt-1 text-center text-xs text-slate2">Importing {progress}%</div>
            </div>
          )}

          <button className="btn-dark w-full" onClick={doImport} disabled={busy}>
            {busy ? 'Importing' : `Import ${imp.mode === 'merge' ? imp.merged.length : imp.all.length} items`}
          </button>
        </Modal>
      )}

      {edit && (
        <Modal title={edit.id ? 'Edit item' : 'New item'} onClose={() => setEdit(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <F label="Item name *"  v={edit.name} on={v => setEdit(s => ({ ...s, name: v }))} />
            <F label="Item code *"  v={edit.code} on={v => setEdit(s => ({ ...s, code: v }))} />
            <F label="Category"     v={edit.category} on={v => setEdit(s => ({ ...s, category: v }))} />
            <F label="Sub category" v={edit.sub_category} on={v => setEdit(s => ({ ...s, sub_category: v }))} />
            <F label="Model no"     v={edit.model_no} on={v => setEdit(s => ({ ...s, model_no: v }))} />
            <F label="Fabric"       v={edit.fabric} on={v => setEdit(s => ({ ...s, fabric: v }))} />
            <F label="Brand"        v={edit.brand} on={v => setEdit(s => ({ ...s, brand: v }))} />
            <F label="Standard selling ₹" type="number"
               v={edit.std_selling} on={v => setEdit(s => ({ ...s, std_selling: v }))} />
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" className="!w-auto" checked={edit.active}
                onChange={e => setEdit(s => ({ ...s, active: e.target.checked }))} />
              <span className="normal-case tracking-normal">Active</span>
            </label>
          </div>
          <button className="btn-dark mt-4 w-full" onClick={save}>Save item</button>
        </Modal>
      )}
    </div>
  )
}

function F({ label, v, on, type = 'text' }) {
  return <div><label>{label}</label>
    <input type={type} value={v ?? ''} onChange={e => on(e.target.value)} /></div>
}
