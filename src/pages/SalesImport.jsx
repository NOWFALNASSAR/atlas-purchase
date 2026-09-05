import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, inr, lakh, dt } from '../lib/db'

/**
 * Sales data by Excel, until the branch servers are connected.
 *
 * Three sheet types, detected from the column headings:
 *   daily     one row per branch per day
 *   salesman  one row per salesman per day
 *   item      one row per item per day
 *
 * Uploads are keyed on branch + date, so re-uploading a corrected sheet
 * replaces the day rather than adding to it. Sales cannot double.
 */

const TYPES = {
  daily: {
    label: 'Daily sales by branch',
    table: 'sales_daily',
    conflict: 'branch_id,sale_date,location_code',
    required: ['date', 'branch', 'net sales'],
    sample: [{
      'Date': '2026-09-01', 'Branch': 'TDP', 'Bills': 142, 'Qty': 385,
      'Gross': 452000, 'Discount': 12000, 'Tax': 21000,
      'Net Sales': 419000, 'Cost': 271000
    }]
  },
  salesman: {
    label: 'Daily sales by salesman',
    table: 'sales_salesman_daily',
    conflict: 'branch_id,sale_date,location_code,salesman_code',
    required: ['date', 'branch', 'salesman code', 'net sales'],
    sample: [{
      'Date': '2026-09-01', 'Branch': 'TDP',
      'Salesman Code': '15032', 'Salesman Name': 'KHADEEJA O K',
      'Bills': 18, 'Qty': 47, 'Net Sales': 52000, 'Cost': 33000
    }]
  },
  item: {
    label: 'Daily sales by item',
    table: 'sales_item_daily',
    conflict: 'branch_id,sale_date,location_code,item_code',
    required: ['date', 'branch', 'item code', 'net sales'],
    sample: [{
      'Date': '2026-09-01', 'Branch': 'TDP',
      'Item Code': '548148', 'Item Name': 'T SHIRT GIRLS',
      'Division': 'KIDS WEAR', 'Brand': '',
      'Qty': 3, 'Net Sales': 957, 'Cost': 600
    }]
  }
}

export default function SalesImport() {
  const [branches, setBranches] = useState([])
  const [type, setType] = useState('daily')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [recent, setRecent] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    const [b, s] = await Promise.all([
      db.from('branches').select('*').order('code'),
      db.from('sales_daily').select('sale_date, net_sales, branch_id')
        .order('sale_date', { ascending: false }).limit(10)
    ])
    setBranches(b.data || []); setRecent(s.data || [])
  }

  const pick = (r, ...names) => {
    for (const n of names) {
      const k = Object.keys(r).find(x => x.trim().toLowerCase() === n.toLowerCase())
      if (k !== undefined && String(r[k]).trim() !== '') return String(r[k]).trim()
    }
    return ''
  }

  const num = v => {
    const n = Number(String(v).replace(/[₹,\s]/g, ''))
    return isNaN(n) ? 0 : n
  }

  const toDate = v => {
    if (!v) return null
    if (typeof v === 'number') {            // Excel serial date
      const d = new Date(Math.round((v - 25569) * 86400 * 1000))
      return d.toISOString().slice(0, 10)
    }
    const s = String(v).trim()
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
    const d = new Date(s)
    return isNaN(d) ? null : d.toISOString().slice(0, 10)
  }

  async function readFile(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false })
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    if (!raw.length) return alert('That sheet is empty')

    const byCode = {}
    branches.forEach(b => {
      byCode[b.code.toLowerCase()] = b.id
      byCode[b.name.toLowerCase()] = b.id
      if (b.location_code) byCode[b.location_code.toLowerCase()] = b.id
    })

    const good = [], bad = [], unknownBranches = new Set()

    raw.forEach((r, i) => {
      const date = toDate(pick(r, 'Date', 'Sale Date', 'Bill Date') ||
                          r[Object.keys(r).find(k => k.toLowerCase().includes('date'))])
      const branchTxt = pick(r, 'Branch', 'Shop', 'Showroom', 'Branch Code', 'Location')
      const branchId = byCode[branchTxt.toLowerCase()]

      if (!date || !branchId) {
        if (branchTxt && !branchId) unknownBranches.add(branchTxt)
        bad.push({ line: i + 2, why: !date ? 'bad date' : `unknown branch "${branchTxt}"` })
        return
      }

      const base = {
        branch_id: branchId, sale_date: date, location_code: '000',
        qty: num(pick(r, 'Qty', 'Quantity', 'Pieces')),
        net_sales: num(pick(r, 'Net Sales', 'Net', 'Sales', 'Amount')),
        cost: num(pick(r, 'Cost', 'Cost Value', 'COGS')),
        synced_at: new Date().toISOString()
      }

      if (type === 'daily') {
        good.push({ ...base,
          bills: num(pick(r, 'Bills', 'Bill Count', 'Invoices')),
          gross: num(pick(r, 'Gross', 'Gross Amount', 'Gross Sales')),
          discount: num(pick(r, 'Discount', 'Disc')),
          tax: num(pick(r, 'Tax', 'GST', 'Tax Amount')) })
      } else if (type === 'salesman') {
        const code = pick(r, 'Salesman Code', 'Salesman', 'SMAN', 'Employee Code')
        if (!code) { bad.push({ line: i + 2, why: 'no salesman code' }); return }
        good.push({ ...base, salesman_code: code,
          salesman_name: pick(r, 'Salesman Name', 'Name'),
          bills: num(pick(r, 'Bills', 'Bill Count')) })
      } else {
        const code = pick(r, 'Item Code', 'Barcode', 'Code')
        if (!code) { bad.push({ line: i + 2, why: 'no item code' }); return }
        good.push({ ...base, item_code: code,
          item_name: pick(r, 'Item Name', 'Item', 'Description'),
          division: pick(r, 'Division', 'Section', 'Category'),
          brand: pick(r, 'Brand') })
      }
    })

    const dates = good.map(g => g.sale_date).sort()
    setPreview({
      total: raw.length, good, bad,
      unknownBranches: [...unknownBranches],
      from: dates[0], to: dates[dates.length - 1],
      value: good.reduce((s, g) => s + g.net_sales, 0),
      branchCount: new Set(good.map(g => g.branch_id)).size
    })
  }

  async function doImport() {
    const t = TYPES[type]
    setBusy(true); setProgress(0)
    let done = 0
    for (let i = 0; i < preview.good.length; i += 500) {
      const chunk = preview.good.slice(i, i + 500)
      const { error } = await db.from(t.table).upsert(chunk, { onConflict: t.conflict })
      if (error) { setBusy(false); return alert(`Stopped after ${done}: ${error.message}`) }
      done += chunk.length
      setProgress(Math.round(done / preview.good.length * 100))
    }
    setBusy(false); setProgress(0)
    alert(`${done} rows imported.`)
    setPreview(null); load()
  }

  function template() {
    const t = TYPES[type]
    const ws = XLSX.utils.json_to_sheet(t.sample)
    ws['!cols'] = Object.keys(t.sample[0]).map(k => ({ wch: Math.max(k.length + 4, 14) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sales')
    XLSX.writeFile(wb, `sales-${type}-format.xlsx`)
  }

  return (
    <div className="page page-lg space-y-4">
      <div>
        <h1 className="text-xl font-bold">Upload sales</h1>
        <p className="text-sm text-slate2">
          Until the branch servers are connected, sales come in by Excel.
          Re-uploading a corrected sheet replaces that day rather than adding to it.
        </p>
      </div>

      {branches.length === 0 && (
        <div className="card border-l-4 border-l-gold p-4">
          <div className="text-sm font-bold">No branches registered</div>
          <p className="mt-1 text-[13px] text-slate2">
            Sales rows have to attach to a branch. Add your showrooms in
            Settings → Shops first, then register them as branches.
          </p>
        </div>
      )}

      <div className="card p-4">
        <label>What is in the sheet</label>
        <div className="grid gap-2 md:grid-cols-3">
          {Object.entries(TYPES).map(([k, t]) => (
            <button key={k} onClick={() => { setType(k); setPreview(null) }}
              className={'rounded-md border px-3 py-2 text-left text-[13px] ' +
                (type === k ? 'border-ink bg-ink text-white' : 'border-line bg-white')}>
              <span className="block font-semibold">{t.label}</span>
              <span className={'block text-[11px] ' + (type === k ? 'text-white/60' : 'text-slate2')}>
                {t.required.join(', ')}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <label className="btn-gold flex-1 cursor-pointer justify-center">
            Choose Excel file
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              disabled={!branches.length}
              onChange={e => e.target.files[0] && readFile(e.target.files[0])} />
          </label>
          <button className="btn-ghost" onClick={template}>Download format</button>
        </div>
      <div className="card mb-3 border-gold/40 bg-gold2 p-4">
            <div className="text-sm font-semibold text-gold">
              Is this the right screen?
            </div>
            <p className="mt-1 text-xs text-slate2">
              This one takes a summary sheet that has a <strong>branch</strong> column
              in it — one row per branch per day. It is the older format, from before
              the billing exports were wired up.
            </p>
            <p className="mt-1.5 text-xs text-slate2">
              If you have <strong>BILLWISE</strong>, <strong>ITEMWISE</strong> and{' '}
              <strong>SALESMANWISE</strong> straight out of the billing software, they
              belong on <a href="/sales/upload" className="font-semibold text-gold underline">
              Upload BILLWISE + ITEMWISE</a> instead. Those files have no branch column,
              so every row here will be rejected.
            </p>
          </div>

          </div>

      {/* what the branch column must contain */}
      {branches.length > 0 && (
        <details className="card p-3 text-[13px]">
          <summary className="cursor-pointer font-semibold">
            Branch names the upload will recognise
          </summary>
          <p className="mt-2 text-slate2">
            The Branch column can hold any of these. Anything else is rejected
            with the row number, so nothing lands under the wrong showroom.
          </p>
          <ul className="mt-2 grid gap-1 md:grid-cols-2">
            {branches.map(b => (
              <li key={b.id} className="text-[12px]">
                <span className="font-mono font-semibold">{b.code}</span>
                <span className="text-slate2"> or </span>
                <span>{b.name}</span>
                {b.location_code && <span className="text-slate2"> or {b.location_code}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* preview */}
      {preview && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-bold">Check before importing</h2>

          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Rows read" value={preview.total} />
            <Box label="Will import" value={preview.good.length} strong />
            <Box label="Rejected" value={preview.bad.length} warn={preview.bad.length > 0} />
            <Box label="Value" value={lakh(preview.value)} />
          </div>

          {preview.good.length > 0 && (
            <p className="mb-3 text-[13px] text-slate2">
              {dt(preview.from)} to {dt(preview.to)} · {preview.branchCount} branches
            </p>
          )}

          {preview.unknownBranches.length > 0 && (
            <div className="mb-3 rounded-md bg-bad/10 p-3 text-[13px]">
              <div className="font-semibold text-bad">Branch names not recognised</div>
              <div className="mt-1 text-slate2">
                {preview.unknownBranches.join(', ')}
              </div>
              <div className="mt-1 text-[11px] text-slate2">
                Either correct them in the sheet, or rename the branch in Settings to match.
              </div>
            </div>
          )}

          {preview.bad.length > 0 && (
            <details className="mb-3 text-[13px]">
              <summary className="cursor-pointer text-gold">
                {preview.bad.length} rows rejected
              </summary>
              <ul className="mt-2 space-y-0.5 text-[12px] text-slate2">
                {preview.bad.slice(0, 20).map((b, i) => (
                  <li key={i}>Row {b.line}: {b.why}</li>
                ))}
                {preview.bad.length > 20 && <li>and {preview.bad.length - 20} more</li>}
              </ul>
            </details>
          )}

          {busy && (
            <div className="mb-3">
              <div className="h-1.5 rounded-full bg-line">
                <div className="h-1.5 rounded-full bg-ink" style={{ width: progress + '%' }} />
              </div>
              <div className="mt-1 text-center text-xs text-slate2">Importing {progress}%</div>
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn-dark flex-1" onClick={doImport}
              disabled={busy || !preview.good.length}>
              {busy ? 'Importing' : `Import ${preview.good.length} rows`}
            </button>
            <button className="btn-ghost" onClick={() => setPreview(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* what is already loaded */}
      {recent.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-4 py-3 text-sm font-bold">Most recent days loaded</div>
          <ul className="divide-y divide-line">
            {recent.map((r, i) => (
              <li key={i} className="flex justify-between px-4 py-2 text-[13px]">
                <span>{dt(r.sale_date)}</span>
                <span className="font-semibold">{inr(r.net_sales)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Box({ label, value, strong, warn }) {
  return (
    <div className={'rounded-md px-3 py-2 ' + (strong ? 'bg-ink text-white' : 'bg-paper')}>
      <div className={'text-[10px] uppercase tracking-wider ' +
        (strong ? 'text-white/60' : 'text-slate2')}>{label}</div>
      <div className={'text-base font-bold ' + (warn ? 'text-gold' : '')}>{value}</div>
    </div>
  )
}
