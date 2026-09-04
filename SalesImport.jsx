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
  billing_item: {
    label: 'Item-wise export from billing',
    table: 'sales_item_daily',
    conflict: 'branch_id,sale_date,location_code,item_code',
    required: ['Description', 'SalesQty', 'SalesValue'],
    fromBilling: true,
    sample: [{
      'Description': '2 PC GIRLS 62041200', 'SalesQty': 160, 'SalesValue': 90628.56
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
  const [billBranch, setBillBranch] = useState('')
  const [billMonth, setBillMonth] = useState(() => new Date().toISOString().slice(0, 7))
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

  /** Your billing export has the HSN stuck on the end of the item name,
      and no division column. Both come out of the description. */
  function splitDescription(text) {
    const t = String(text).trim()
    const m = t.match(/(\d{6,8})\s*$/)
    return {
      item: t.replace(/\s*\d{6,8}\s*$/, '').trim(),
      hsn: m ? m[1] : null
    }
  }

  function guessDivision(name) {
    const u = name.toUpperCase()
    const has = (...w) => w.some(x => u.includes(x))
    if (has('GENTS', 'MENS', 'DHOTI', 'DHOTHI', 'MUND', 'LUNGI', 'SHIRT GENTS'))
      return 'GENTS WEAR'
    if (has('LADIES', 'WOMEN', 'SAREE', 'CHURIDHAR', 'NIGHTY', 'BLOUSE', 'BRA',
            'KURTI', 'LEGGING', 'PALAZ'))
      return 'LADIES WEAR'
    if (has('BOYS', 'GIRLS', 'KIDS', 'BABA', 'FROCK', 'NEW BORN', 'INFANT'))
      return 'KIDS WEAR'
    if (has('CURTAIN', 'BEDSHEET', 'TOWEL', 'PILLOW', 'BLANKET', 'CARPET',
            'CUSHION', 'DOOR MAT'))
      return 'HOME DECOR'
    return 'OTHER'
  }

  async function readBillingFile(file) {
    if (!billBranch) return alert('Choose which branch this file is for')
    const wb = XLSX.read(await file.arrayBuffer())
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })

    // the export ends with a totals row — drop it, then use it to check
    const clean = raw.filter(r => {
      const d = String(pick(r, 'Description') || '')
      return d && !/^page\s*-/i.test(d)
    })
    const totalsRow = raw.find(r => /^page\s*-/i.test(String(pick(r, 'Description') || '')))

    // a monthly export is stored against the last day of that month
    const [y, m] = billMonth.split('-').map(Number)
    const saleDate = new Date(y, m, 0).toISOString().slice(0, 10)

    const good = [], bad = []
    const seen = new Map()

    clean.forEach((r, i) => {
      const desc = pick(r, 'Description')
      const qty = num(pick(r, 'SalesQty', 'Qty'))
      const value = num(pick(r, 'SalesValue', 'Value'))
      if (!desc) { bad.push({ line: i + 2, why: 'no description' }); return }

      const { item, hsn } = splitDescription(desc)
      const code = hsn ? `${item}|${hsn}` : item

      // the same item can appear twice under one HSN — add them together
      if (seen.has(code)) {
        const e = seen.get(code)
        e.qty += qty; e.net_sales += value
        return
      }
      const row = {
        branch_id: billBranch, sale_date: saleDate, location_code: '000',
        item_code: code, item_name: item,
        division: guessDivision(item),
        brand: hsn ? 'HSN ' + hsn : null,
        qty, net_sales: value, cost: 0,
        synced_at: new Date().toISOString()
      }
      seen.set(code, row); good.push(row)
    })

    const value = good.reduce((s, g) => s + g.net_sales, 0)
    const qty = good.reduce((s, g) => s + g.qty, 0)
    const declaredValue = totalsRow ? num(pick(totalsRow, 'SalesValue', 'Value')) : null
    const declaredQty = totalsRow ? num(pick(totalsRow, 'SalesQty', 'Qty')) : null

    const byDivision = {}
    good.forEach(g => {
      byDivision[g.division] = (byDivision[g.division] || 0) + g.net_sales
    })

    setPreview({
      total: raw.length, good, bad, unknownBranches: [],
      from: saleDate, to: saleDate, value, qty, branchCount: 1,
      declaredValue, declaredQty, byDivision,
      matches: declaredValue == null ||
               Math.abs(declaredValue - value) < Math.max(1, declaredValue * 0.001)
    })
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
    <div className="mx-auto max-w-3xl space-y-4">
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

        {TYPES[type].fromBilling && (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <label>Which branch is this file for?</label>
              <select value={billBranch} onChange={e => setBillBranch(e.target.value)}>
                <option value="">Choose branch</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label>Which month?</label>
              <input type="month" value={billMonth}
                onChange={e => setBillMonth(e.target.value)} />
            </div>
            <p className="text-[11px] text-slate2 md:col-span-2">
              The export has no date column, so the whole month is stored against
              its last day. One file per branch per month.
            </p>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <label className="btn-gold flex-1 cursor-pointer justify-center">
            Choose Excel file
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              disabled={!branches.length}
              onChange={e => e.target.files[0] &&
                (TYPES[type].fromBilling
                  ? readBillingFile(e.target.files[0])
                  : readFile(e.target.files[0]))} />
          </label>
          <button className="btn-ghost" onClick={template}>Download format</button>
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

          {preview.declaredValue != null && (
            <div className={'mb-3 rounded-md p-3 text-[13px] ' +
              (preview.matches ? 'bg-good/10' : 'bg-bad/10')}>
              <div className={'font-semibold ' + (preview.matches ? 'text-good' : 'text-bad')}>
                {preview.matches
                  ? 'Matches the total row in your file'
                  : 'Does NOT match the total row in your file'}
              </div>
              <div className="mt-1 text-slate2">
                File says {inr(preview.declaredValue)} · {Math.round(preview.declaredQty)} pcs.
                Read {inr(preview.value)} · {Math.round(preview.qty)} pcs.
              </div>
            </div>
          )}

          {preview.byDivision && (
            <div className="mb-3">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate2">
                Divisions worked out from the item names
              </div>
              <ul className="space-y-1 text-[13px]">
                {Object.entries(preview.byDivision)
                  .sort((a, b) => b[1] - a[1]).map(([d, v]) => (
                  <li key={d} className="flex justify-between">
                    <span className={d === 'OTHER' ? 'text-gold' : ''}>{d}</span>
                    <span className="font-semibold">
                      {inr(v)}
                      <span className="ml-2 font-normal text-slate2">
                        {(v / preview.value * 100).toFixed(0)}%
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {preview.byDivision.OTHER && (
                <p className="mt-1 text-[11px] text-slate2">
                  Anything in OTHER did not match a keyword. Tell me what those
                  items are and the rule can be widened.
                </p>
              )}
            </div>
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
