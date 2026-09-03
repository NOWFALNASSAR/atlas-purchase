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
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [place, setPlace] = useState('')
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState(null)
  const [imp, setImp] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const PAGE = 50

  useEffect(() => {
    const t = setTimeout(() => { setTerm(q); setPage(0) }, 350)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => { load() }, [term, place, page])

  useEffect(() => {
    db.from('v_supplier_places').select('*').limit(200)
      .then(({ data }) => setPlaces(data || []))
  }, [])

  async function load() {
    setLoading(true)
    let sel = db.from('suppliers').select('*', { count: 'exact' })
    if (term) sel = sel.or(`name.ilike.%${term}%,code.ilike.%${term}%,mobile.ilike.%${term}%`)
    if (place) sel = sel.eq('place', place)
    const { data, count } = await sel
      .order('name').range(page * PAGE, page * PAGE + PAGE - 1)
    setRows(data || []); setTotal(count || 0); setLoading(false)
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

  /* ---------- blank template so nobody guesses the columns ---------- */
  function downloadTemplate() {
    const sample = [{
      'SUPPLIER NAME': 'ABC Textiles',
      'ADDRESS': 'No 8, Jaya Hanuman Complex',
      'ADDRESS 2': '1st Cross Road',
      'PLACE': 'BENGALURU',
      'Phone': '9886641396',
      'GSTIN': '',
      'Contact Person': '',
      'Email': '',
      'Credit Days': '',
      'Category': ''
    }]
    const ws = XLSX.utils.json_to_sheet(sample)
    ws['!cols'] = Object.keys(sample[0]).map(k => ({ wch: Math.max(k.length + 4, 16) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Suppliers')
    XLSX.writeFile(wb, 'supplier-upload-format.xlsx')
  }

  /* ---------- Excel import ---------- */
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
    const phone = v => v.replace(/\D/g, '').slice(-10)

    const mapped = raw.map(r => {
      const mob = phone(pick(r, 'Phone', 'Mobile', 'Mobile No'))
      return {
        code:           pick(r, 'Supplier Code', 'code'),
        name:           pick(r, 'SUPPLIER NAME', 'Supplier Name', 'name'),
        company_name:   pick(r, 'Company Name'),
        gstin:          pick(r, 'GSTIN'),
        contact_person: pick(r, 'Contact Person'),
        mobile:         mob,
        whatsapp:       phone(pick(r, 'WhatsApp')) || mob,
        email:          pick(r, 'Email'),
        address:        pick(r, 'ADDRESS', 'Address'),
        address2:       pick(r, 'ADDRESS 2', 'Address 2'),
        place:          pick(r, 'PLACE', 'Place', 'City'),
        credit_days:    Number(pick(r, 'Credit Days')) || 0,
        category:       pick(r, 'Category')
      }
    }).filter(m => m.name)

    // the export repeats some supplier names — keep the first of each
    const seen = new Set()
    const unique = []
    let repeats = 0
    for (const m of mapped) {
      const k = m.name.toLowerCase()
      if (seen.has(k)) { repeats++; continue }
      seen.add(k); unique.push(m)
    }

    const existing = new Set(rows.map(s => s.name.toLowerCase().trim()))
    setImp({
      total: raw.length,
      repeats,
      fresh: unique.filter(m => !existing.has(m.name.toLowerCase())),
      already: unique.filter(m => existing.has(m.name.toLowerCase())).length,
      withPhone: unique.filter(m => m.mobile).length
    })
  }

  async function doImport() {
    let next = rows.reduce((mx, s) => {
      const m = /^SUP(\d+)$/.exec(s.code || '')
      return m ? Math.max(mx, Number(m[1])) : mx
    }, 0)

    const payload = imp.fresh.map(r => ({
      ...r, code: r.code || 'SUP' + String(++next).padStart(4, '0'), active: true
    }))

    setBusy(true)
    let done = 0
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await db.from('suppliers').insert(payload.slice(i, i + 500))
      if (error) { setBusy(false); return alert(`Stopped after ${done}: ${error.message}`) }
      done += Math.min(500, payload.length - i)
      setProgress(Math.round((done / payload.length) * 100))
    }
    setBusy(false); setProgress(0)
    alert(`${done} suppliers imported.`)
    setImp(null); load()
  }

  const shown = rows
  const pages = Math.ceil(total / PAGE)

  return (
    <div className="page page-lg space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Suppliers</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={downloadTemplate}>See format</button>
          <label className="btn-ghost cursor-pointer">
            Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => e.target.files[0] && readFile(e.target.files[0])} />
          </label>
          <button className="btn-gold" onClick={() => setEdit({ ...BLANK })}>Add supplier</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input className="col-span-2" value={q} onChange={e => setQ(e.target.value)}
               placeholder="Search name, code or phone" />
        <select value={place} onChange={e => { setPlace(e.target.value); setPage(0) }}>
          <option value="">All places</option>
          {places.map(p => (
            <option key={p.place} value={p.place}>{p.place} ({p.suppliers})</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between text-[12px] text-slate2">
        <span>
          {loading ? 'Searching' :
            total === 0 ? 'Nothing found' :
            `${total.toLocaleString('en-IN')} suppliers${term ? ' matching “' + term + '”' : ''}`}
        </span>
        {pages > 1 && <span>Page {page + 1} of {pages}</span>}
      </div>

      <details className="card p-3 text-[13px]">
        <summary className="cursor-pointer font-semibold">Excel upload format</summary>

        <p className="mt-2 font-semibold">Your billing software export works as it is</p>
        <div className="mt-2 overflow-x-auto">
          <table className="text-[11px]">
            <thead className="bg-paper">
              <tr>{['SUPPLIER NAME','ADDRESS','ADDRESS 2','PLACE','Phone']
                .map(h => <th key={h} className="whitespace-nowrap border border-line px-2 py-1">{h}</th>)}</tr>
            </thead>
            <tbody>
              <tr>{['A K FASHION','No 8, Jaya Hanuman','Bengaluru, 1st Cross','BENGALURU','9886641396']
                .map((c,i) => <td key={i} className="whitespace-nowrap border border-line px-2 py-1">{c}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-slate2">
          Only <b>SUPPLIER NAME</b> is compulsory. Phone numbers are cleaned to
          10 digits automatically, and repeated names are imported once.
        </p>

        <p className="mt-4 font-semibold">Optional extra columns</p>
        <p className="text-slate2">
          GSTIN, Contact Person, WhatsApp, Email, Credit Days, Category —
          add these when you have them, or fill them in later on each supplier.
        </p>

        <button className="btn-ghost mt-3" onClick={downloadTemplate}>
          Download blank format
        </button>
      </details>

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
                  {[r.code, r.place, r.mobile, r.credit_days ? r.credit_days + 'd credit' : null]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="text-xs text-slate2">Edit</span>
            </button>
          </li>
        ))}
        {!loading && shown.length === 0 && (
          <li className="p-8 text-center text-sm text-slate2">
            No suppliers match. Try a shorter search.
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

      {/* import preview */}
      {imp && (
        <Modal title="Check before importing" onClose={() => !busy && setImp(null)}>
          <ul className="mb-3 space-y-1 text-sm">
            <li>{imp.total} rows read from the file</li>
            {imp.repeats > 0 && (
              <li className="text-gold">{imp.repeats} repeated names — only the first of each is kept</li>
            )}
            {imp.already > 0 && (
              <li className="text-slate2">{imp.already} already in your supplier master — skipped</li>
            )}
            <li className="font-semibold">{imp.fresh.length} suppliers will be added</li>
            <li className="text-slate2">
              {imp.withPhone} of them have a phone number
              {imp.fresh.length > 0 &&
                ` (${Math.round(imp.withPhone / imp.fresh.length * 100)}%)`}
            </li>
          </ul>

          <p className="mb-3 text-xs text-slate2">
            Supplier codes are generated automatically. Suppliers with no phone
            number import fine — you can add numbers later, but the PO cannot be
            sent on WhatsApp until one is filled in.
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
            {busy ? 'Importing' : `Import ${imp.fresh.length} suppliers`}
          </button>
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
      <div className="safe-b max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-pop md:max-w-xl md:rounded-xl lg:max-w-2xl lg:p-6"
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
