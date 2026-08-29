import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, inr } from '../lib/db'
import { Modal } from './Suppliers'

const BLANK = { code: '', name: '', category: '', sub_category: '', model_no: '',
                fabric: '', brand: '', std_selling: '', active: true }

export default function Items() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [edit, setEdit] = useState(null)
  const [imp, setImp] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await db.from('items').select('*').order('name').limit(2000)
    setRows(data || [])
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
      'Item Code': 'LAD-KUR-00001',
      'Item Name': 'Ladies Kurti Cotton',
      'Category': 'Ladies',
      'Sub Category': 'Kurti',
      'Model': 'K101',
      'Fabric': 'Cotton',
      'Brand': '',
      'Selling Rate': 699
    }]
    const ws = XLSX.utils.json_to_sheet(sample)
    ws['!cols'] = Object.keys(sample[0]).map(k => ({ wch: Math.max(k.length + 4, 16) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Items')
    XLSX.writeFile(wb, 'item-upload-format.xlsx')
  }

  async function readFile(file) {
    const wb = XLSX.read(await file.arrayBuffer())
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
    const mapped = raw.map(r => ({
      code:         String(r['Item Code'] || r.code || '').trim(),
      name:         String(r['Item Name'] || r.name || '').trim(),
      category:     String(r['Category'] || r.category || '').trim(),
      sub_category: String(r['Sub Category'] || r.sub_category || '').trim(),
      model_no:     String(r['Model'] || r['Model No'] || r.model_no || '').trim(),
      fabric:       String(r['Fabric'] || r.fabric || '').trim(),
      brand:        String(r['Brand'] || r.brand || '').trim(),
      std_selling:  Number(r['Selling Rate'] || r.std_selling || 0) || null
    }))
    const codes = new Set(rows.map(i => i.code))
    setImp({
      rows: mapped,
      bad: mapped.filter(m => !m.code || !m.name),
      dupes: mapped.filter(m => m.code && codes.has(m.code))
    })
  }

  async function doImport(mode) {
    const clean = imp.rows.filter(r => r.code && r.name)
    const newOnes = clean.filter(r => !imp.dupes.includes(r))
    let msg = ''
    if (newOnes.length) {
      const { error } = await db.from('items').insert(newOnes)
      if (error) return alert(error.message)
      msg += `${newOnes.length} new items added. `
    }
    if (mode === 'update' && imp.dupes.length) {
      for (const r of imp.dupes) await db.from('items').update(r).eq('code', r.code)
      msg += `${imp.dupes.length} existing items updated.`
    }
    alert(msg || 'Nothing to import.')
    setImp(null); load()
  }

  const cats = [...new Set(rows.map(r => r.category).filter(Boolean))].sort()
  const shown = rows.filter(r =>
    (!cat || r.category === cat) &&
    (!q || (r.name + r.code + (r.model_no || '')).toLowerCase().includes(q.toLowerCase()))
  ).slice(0, 300)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
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
        <p className="mt-2 text-slate2">
          Column headings must match exactly. <b>Item Code</b> and <b>Item Name</b>
          are compulsory; the rest are optional.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="text-[11px]">
            <thead className="bg-paper">
              <tr>{['Item Code','Item Name','Category','Sub Category','Model','Fabric','Brand','Selling Rate']
                .map(h => <th key={h} className="whitespace-nowrap border border-line px-2 py-1">{h}</th>)}</tr>
            </thead>
            <tbody>
              <tr>{['LAD-KUR-00001','Ladies Kurti Cotton','Ladies','Kurti','K101','Cotton','','699']
                .map((c,i) => <td key={i} className="whitespace-nowrap border border-line px-2 py-1">{c}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-slate2">
          Item code format: CATEGORY-SUBCATEGORY-SERIAL, decided once and never changed.
          Codes must be unique — a repeat code is treated as the same item.
        </p>
        <button className="btn-ghost mt-3" onClick={downloadTemplate}>
          Download blank format
        </button>
      </details>

      <div className="grid grid-cols-3 gap-2">
        <input className="col-span-2" value={q} onChange={e => setQ(e.target.value)}
               placeholder="Search name, code or model" />
        <select value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <ul className="card divide-y divide-line">
        {shown.map(r => (
          <li key={r.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper"
              onClick={() => setEdit(r)}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.name}</div>
                <div className="font-mono text-[11px] text-slate2">
                  {[r.code, r.model_no, r.category].filter(Boolean).join(' · ')}
                </div>
              </div>
              {r.std_selling && <span className="text-sm font-semibold">{inr(r.std_selling)}</span>}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="p-8 text-center text-sm text-slate2">No items match.</li>}
      </ul>
      {rows.length > 300 && <p className="text-center text-xs text-slate2">Showing first 300 — use search.</p>}

      {imp && (
        <Modal title="Check before importing" onClose={() => setImp(null)}>
          <ul className="mb-4 space-y-1 text-sm">
            <li>{imp.rows.length} rows read</li>
            {imp.bad.length > 0 && <li className="text-bad">{imp.bad.length} rows missing code or name — skipped</li>}
            {imp.dupes.length > 0 && <li className="text-gold">{imp.dupes.length} item codes already exist</li>}
            <li className="font-semibold">{imp.rows.length - imp.bad.length - imp.dupes.length} new items</li>
          </ul>
          <div className="grid gap-2">
            <button className="btn-dark" onClick={() => doImport('skip')}>Add new only, skip existing</button>
            {imp.dupes.length > 0 &&
              <button className="btn-ghost" onClick={() => doImport('update')}>Add new and update existing</button>}
          </div>
          <p className="mt-3 text-xs text-slate2">
            Expected columns: Item Code, Item Name, Category, Sub Category, Model, Fabric, Brand, Selling Rate.
          </p>
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
