import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, inr } from '../lib/db'

const BLANK = {
  code: '', name: '', company_name: '', gstin: '', contact_person: '', mobile: '',
  whatsapp: '', email: '', address: '', state: 'Kerala', payment_terms: '',
  credit_days: 0, category: '', active: true
}

export default function Suppliers() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const [imp, setImp] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await db.from('suppliers').select('*').order('name')
    setRows(data || [])
  }

  async function save() {
    const row = { ...edit, credit_days: Number(edit.credit_days) || 0 }
    if (!row.name?.trim()) return alert('Supplier name is required')
    if (!row.code?.trim()) row.code = 'SUP' + String(rows.length + 1).padStart(3, '0')
    const { error } = row.id
      ? await db.from('suppliers').update(row).eq('id', row.id)
      : await db.from('suppliers').insert(row)
    if (error) return alert(error.message)
    setEdit(null); load()
  }

  /* ---------- Excel import ---------- */
  async function readFile(file) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
    const mapped = raw.map(r => ({
      code:           str(r['Supplier Code'] || r.code),
      name:           str(r['Supplier Name'] || r.name),
      company_name:   str(r['Company Name'] || r.company_name),
      gstin:          str(r['GSTIN'] || r.gstin),
      contact_person: str(r['Contact Person'] || r.contact_person),
      mobile:         str(r['Mobile'] || r.mobile),
      whatsapp:       str(r['WhatsApp'] || r.whatsapp || r['Mobile']),
      email:          str(r['Email'] || r.email),
      address:        str(r['Address'] || r.address),
      credit_days:    Number(r['Credit Days'] || r.credit_days || 0),
      category:       str(r['Category'] || r.category)
    }))
    const existing = new Set(rows.map(s => s.name.toLowerCase().trim()))
    setImp({
      rows: mapped,
      bad: mapped.filter(m => !m.name),
      dupes: mapped.filter(m => m.name && existing.has(m.name.toLowerCase().trim()))
    })
  }

  async function doImport() {
    const good = imp.rows.filter(r => r.name && !imp.dupes.includes(r))
      .map((r, i) => ({ ...r, code: r.code || 'SUP' + String(rows.length + i + 1).padStart(3, '0') }))
    const { error } = await db.from('suppliers').insert(good)
    if (error) return alert(error.message)
    alert(`${good.length} suppliers imported.`)
    setImp(null); load()
  }

  const shown = q ? rows.filter(r =>
    (r.name + r.code + (r.mobile || '')).toLowerCase().includes(q.toLowerCase())) : rows

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Suppliers</h1>
        <div className="flex gap-2">
          <label className="btn-ghost cursor-pointer">
            Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => e.target.files[0] && readFile(e.target.files[0])} />
          </label>
          <button className="btn-gold" onClick={() => setEdit({ ...BLANK })}>Add supplier</button>
        </div>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search suppliers" />

      <ul className="card divide-y divide-line">
        {shown.map(r => (
          <li key={r.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper"
              onClick={() => setEdit(r)}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {r.name} {!r.active && <span className="tag bg-line text-slate2">off</span>}
                </div>
                <div className="text-[11px] text-slate2">
                  {[r.code, r.mobile, r.credit_days ? r.credit_days + 'd credit' : null]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="text-xs text-slate2">Edit</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="p-8 text-center text-sm text-slate2">No suppliers yet.</li>}
      </ul>

      {/* import preview */}
      {imp && (
        <Modal title="Check before importing" onClose={() => setImp(null)}>
          <ul className="mb-4 space-y-1 text-sm">
            <li>{imp.rows.length} rows read</li>
            {imp.bad.length > 0 && <li className="text-bad">{imp.bad.length} rows have no name — they will be skipped</li>}
            {imp.dupes.length > 0 && <li className="text-gold">{imp.dupes.length} already exist by name — they will be skipped</li>}
            <li className="font-semibold">
              {imp.rows.length - imp.bad.length - imp.dupes.length} will be added
            </li>
          </ul>
          <button className="btn-dark w-full" onClick={doImport}>Import them</button>
          <p className="mt-3 text-xs text-slate2">
            Expected columns: Supplier Name, Company Name, GSTIN, Contact Person, Mobile,
            WhatsApp, Email, Address, Credit Days, Category.
          </p>
        </Modal>
      )}

      {/* editor */}
      {edit && (
        <Modal title={edit.id ? 'Edit supplier' : 'New supplier'} onClose={() => setEdit(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <F label="Supplier name *" v={edit.name} on={v => setEdit(s => ({ ...s, name: v }))} />
            <F label="Company name"    v={edit.company_name} on={v => setEdit(s => ({ ...s, company_name: v }))} />
            <F label="Supplier code"   v={edit.code} on={v => setEdit(s => ({ ...s, code: v }))} />
            <F label="GSTIN"           v={edit.gstin} on={v => setEdit(s => ({ ...s, gstin: v }))} />
            <F label="Contact person"  v={edit.contact_person} on={v => setEdit(s => ({ ...s, contact_person: v }))} />
            <F label="Mobile"          v={edit.mobile} on={v => setEdit(s => ({ ...s, mobile: v }))} />
            <F label="WhatsApp"        v={edit.whatsapp} on={v => setEdit(s => ({ ...s, whatsapp: v }))} />
            <F label="Email"           v={edit.email} on={v => setEdit(s => ({ ...s, email: v }))} />
            <F label="Credit days"     v={edit.credit_days} on={v => setEdit(s => ({ ...s, credit_days: v }))} type="number" />
            <F label="Category"        v={edit.category} on={v => setEdit(s => ({ ...s, category: v }))} />
            <div className="md:col-span-2">
              <F label="Address" v={edit.address} on={v => setEdit(s => ({ ...s, address: v }))} />
            </div>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" className="!w-auto" checked={edit.active}
                onChange={e => setEdit(s => ({ ...s, active: e.target.checked }))} />
              <span className="normal-case tracking-normal">Active — can be used in new orders</span>
            </label>
          </div>
          <button className="btn-dark mt-4 w-full" onClick={save}>Save supplier</button>
        </Modal>
      )}
    </div>
  )
}

const str = v => (v === undefined || v === null ? '' : String(v).trim())

function F({ label, v, on, type = 'text' }) {
  return <div><label>{label}</label>
    <input type={type} value={v ?? ''} onChange={e => on(e.target.value)} /></div>
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 md:rounded-xl"
           onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <button onClick={onClose} className="text-sm text-slate2">Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}
