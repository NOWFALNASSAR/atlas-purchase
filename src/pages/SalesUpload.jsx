import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { db, inr, lakh, dt, num } from '../lib/db'

/* ==================================================================
   DAILY SALES UPLOAD

   The three exports go in here instead of through a script.

   Two things matter more than convenience:

   The files are RECONCILED before anything is written. If the item
   file and the bill file disagree on the ex-tax total, the upload is
   refused. A file exported at four o'clock while the shop is still
   trading will otherwise quietly understate the day, and nobody finds
   out until the month does not add up.

   A day, once in, is LOCKED. Loading the same day twice is how a
   month's figures double. Unlocking is deliberate, needs a reason, and
   only MD Office can do it.
   ================================================================== */

/* Above this the difference is worth explaining, but the upload still
   goes ahead.

   Blocking was the wrong trade. A refused upload means no figures at
   all for that day, which is worse than figures with a known gap
   written against them. So: always upload, always record the
   difference, and ask for a note when it is more than rounding.

   v_upload_variances lists every day that did not agree, worst first.
   A branch that is a few thousand out every day is exporting its files
   before closing, and that pattern is only visible if the days were
   loaded in the first place. */
const TOLERANCE = 1000

const FILES = [
  ['bill', 'BILLWISE',     'One row per bill — the day, the branch and the tax split come from here', true],
  ['item', 'ITEMWISE',     'One row per barcode — quantity, value, cost and margin',                  true],
  ['man',  'SALESMANWISE', 'One row per salesman — value and bills',                                  false]
]

export default function SalesUpload() {
  const [files, setFiles] = useState({})
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [note, setNote] = useState('')
  const [status, setStatus] = useState([])
  const [locked, setLocked] = useState(false)
  const inputs = { bill: useRef(), item: useRef(), man: useRef() }

  useEffect(() => { loadStatus() }, [])
  useEffect(() => { if (files.bill) parse() }, [files])

  async function loadStatus() {
    const { data } = await db.from('v_upload_status').select('*')
      .order('sale_date', { ascending: false }).limit(30)
    setStatus(data || [])
  }

  /* ---------- reading the workbooks ---------- */

  const num0 = v => {
    const x = Number(String(v ?? '').replace(/,/g, ''))
    return Number.isFinite(x) ? x : 0
  }

  const readSheet = async (file, asArray) => {
    /* Uint8Array, not the bare ArrayBuffer. The browser build of
       SheetJS reads an ArrayBuffer as text — the first "row" comes back
       as the raw ZIP header and every column is missing. It works in
       Node either way, which is exactly why this only showed up when
       the page was driven for real. */
    const buf = new Uint8Array(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const sh = wb.Sheets[wb.SheetNames[0]]
    return asArray
      ? XLSX.utils.sheet_to_json(sh, { header: 1 })
      : XLSX.utils.sheet_to_json(sh)
  }

  const billDate = v => {
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{2})/)
    return m ? `20${m[3]}-${m[2]}-${m[1]}` : null
  }

  /* 'General' is the till's word for a walk-in, not a person */
  const WALK_IN = new Set(['GENERAL', 'CASH', 'CUSTOMER', 'C', '-'])
  const customer = raw => {
    const s = String(raw ?? '').replace(/,+$/, '').replace(/^,+/, '').trim()
    if (!s || WALK_IN.has(s.toUpperCase())) return { name: null, phone: null }
    const phone = (s.match(/(\d{10})/) || [])[1] || null
    let name = s.replace(/\d{10}/, '').replace(/[-,\s]+$/, '').replace(/^[-,\s]+/, '').trim()
    if (!name || WALK_IN.has(name.toUpperCase())) name = null
    return { name, phone }
  }

  async function parse() {
    setError(null); setParsed(null); setDone(null); setLocked(false)
    try {
      const bills = await readSheet(files.bill, false)
      if (!bills.length) throw new Error('BILLWISE has no rows')

      const date = billDate(bills[0].Date)
      const branch = String(bills[0].BranchName ?? '').trim()
      if (!date) throw new Error('Could not read the date from BILLWISE')
      if (!branch) throw new Error('Could not read the branch from BILLWISE')

      let amount = 0, taxable = 0, tax = 0, live = 0
      const billRows = bills.map(b => {
        const c = customer(b.Customer)
        const cancelled = String(b.Cncld ?? 'N').toUpperCase().startsWith('Y')
        const slabs = [3, 5, 12, 18, 28, 40].map(p => [num0(b['Amt' + p]), num0(b['VAT' + p])])
        const tx = slabs.reduce((s, [a]) => s + a, 0)
        const vt = num0(b.VATTot) || slabs.reduce((s, [, v]) => s + v, 0)
        if (!cancelled) { amount += num0(b.Amount); taxable += tx; tax += vt; live++ }
        return { b, c, cancelled, slabs, tx, vt }
      })

      /* the last row of these exports is a totals line, shifted one
         column left — dropped by position, because barcodes like
         503377 are numbers and would be mistaken for it */
      let items = [], itemTotal = 0, cost = 0, margin = 0, discount = 0, pieces = 0
      if (files.item) {
        const rows = await readSheet(files.item, true)
        items = rows.slice(1, -1)
          .map(r => ({ barcode: String(r[0] ?? '').trim(), qty: num0(r[1]), value: num0(r[2]),
                       cost: num0(r[4]), margin: num0(r[5]), discount: num0(r[9]) }))
          .filter(r => r.barcode)
        for (const r of items) {
          itemTotal += r.value; cost += r.cost; margin += r.margin
          discount += r.discount; pieces += r.qty
        }
      }

      let people = []
      if (files.man) {
        const rows = await readSheet(files.man, true)
        people = rows.slice(1, -1).map(r => {
          const d = String(r[0] ?? '').trim()
          const sp = d.indexOf(' ')
          return { code: sp > 0 ? d.slice(0, sp) : d,
                   name: sp > 0 ? d.slice(sp + 1).trim() : null,
                   qty: num0(r[1]), value: num0(r[2]), bills: num0(r[3]) }
        }).filter(r => r.code)
      }

      const variance = files.item ? Math.round((itemTotal - taxable) * 100) / 100 : 0
      const gap = Math.abs(variance)
      const reconciled = gap <= TOLERANCE
      const exact = gap <= 1

      // already uploaded?
      const { data: existing } = await db.from('sales_uploads')
        .select('*').eq('branch_code', branch).eq('sale_date', date).maybeSingle()
      if (existing) setLocked(true)

      setParsed({ date, branch, billRows, items, people, live, amount, taxable, tax,
                  itemTotal, cost, margin, discount, pieces, variance, reconciled,
                  exact, existing })
    } catch (e) {
      setError(e.message)
    }
  }

  /* What gets written against the day. The measured difference always,
     plus whatever the person typed. */
  function noteText(p) {
    const bits = []
    if (p && Math.abs(p.variance) > 1) {
      bits.push(`Bill file and item file ${inr(Math.abs(p.variance))} apart ` +
                `(bills ${inr(p.taxable)}, items ${inr(p.itemTotal)}).`)
    }
    if (note.trim()) bits.push(note.trim())
    return bits.length ? bits.join(' ') : null
  }

  /* ---------- writing it ---------- */

  async function upload() {
    if (!parsed || locked) return
    setBusy(true); setError(null)
    const p = parsed
    try {
      const chunks = (arr, size) => {
        const out = []
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
        return out
      }

      for (const part of chunks(p.billRows, 200)) {
        const { error } = await db.from('sales_bills').insert(part.map(({ b, c, cancelled, slabs, tx, vt }) => ({
          bill_date: p.date, branch_code: p.branch,
          bill_no: String(b.No ?? '').trim(), invoice_no: b.InvNo ? String(b.InvNo) : null,
          form: b.Form ? String(b.Form) : null,
          customer_raw: b.Customer ? String(b.Customer) : null,
          customer_name: c.name, customer_phone: c.phone,
          amount: num0(b.Amount), taxable: tx, tax_total: vt, exempted: num0(b.Exempted),
          amt3: slabs[0][0],  vat3: slabs[0][1],  amt5: slabs[1][0],  vat5: slabs[1][1],
          amt12: slabs[2][0], vat12: slabs[2][1], amt18: slabs[3][0], vat18: slabs[3][1],
          amt28: slabs[4][0], vat28: slabs[4][1], amt40: slabs[5][0], vat40: slabs[5][1],
          cancelled, user_code: b.UserCode ? String(b.UserCode) : null
        })))
        if (error) throw error
      }

      for (const part of chunks(p.items, 300)) {
        const { error } = await db.from('sales_barcode_daily').insert(part.map(r => ({
          sale_date: p.date, branch_code: p.branch, barcode: r.barcode,
          qty: r.qty, value_extax: r.value, cost: r.cost,
          margin: r.margin, discount: r.discount
        })))
        if (error) throw error
      }

      if (p.people.length) {
        const { error } = await db.from('sales_person_daily').insert(p.people.map(r => ({
          sale_date: p.date, branch_code: p.branch, person_code: r.code,
          person_name: r.name, qty: r.qty, value_extax: r.value,
          bills: Math.round(r.bills), is_returns_counter: r.value < 0
        })))
        if (error) throw error
      }

      const { error: upErr } = await db.from('sales_uploads').insert({
        sale_date: p.date, branch_code: p.branch, bills: p.live,
        amount: p.amount, taxable: p.taxable, tax_total: p.tax,
        cost: p.cost, margin: p.margin, discount: p.discount, qty: p.pieces,
        reconciled: p.exact, variance: p.variance,
        variance_pct: p.taxable ? Math.round(p.variance / p.taxable * 100000) / 1000 : null,
        note: noteText(p), locked: true, source: 'app'
      })
      if (upErr) throw upErr

      // fill in division and supplier from the godown master
      await db.rpc('relink_sales', { p_from: p.date })

      setDone(p)
      setLocked(true)
      loadStatus()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const [clearing, setClearing] = useState(null)
  const [clearWhy, setClearWhy] = useState('')

  async function doClear() {
    if (!clearWhy.trim()) return
    setBusy(true)
    const { error } = await db.rpc('unlock_sales_day', {
      p_branch: clearing.branch_code, p_date: clearing.sale_date, p_reason: clearWhy.trim()
    })
    setBusy(false)
    if (error) return setError(error.message)
    setClearing(null); setClearWhy('')
    setLocked(false)
    loadStatus()
  }

  function reset() {
    setFiles({}); setParsed(null); setDone(null); setError(null); setLocked(false); setNote('')
    Object.values(inputs).forEach(r => { if (r.current) r.current.value = '' })
  }

  /* ---------- render ---------- */

  return (
    <div className="page page-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Upload the day's sales</h1>
        <p className="text-sm text-slate2">
          The three exports from the billing software. They are checked against each
          other before anything is saved.
        </p>
      </div>

      {/* ---------- finished ---------- */}
      {done && (
        <div className="card overflow-hidden border-good">
          <div className="flex items-center gap-3 bg-good px-4 py-3 text-white">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-base">✓</span>
            <div>
              <div className="text-sm font-semibold">Upload finished</div>
              <div className="text-2xs text-white/80">
                {done.branch} · {dt(done.date)} · locked
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="Bills" value={done.live} />
            <Cell label="Without tax" value={lakh(done.taxable)} />
            <Cell label="Margin" value={lakh(done.margin)} />
            <Cell label="Barcodes" value={done.items.length} />
          </div>
          <div className="flex gap-2 border-t border-line p-4">
            <Link to="/sales/reports" className="btn-dark flex-1 text-center">See the reports</Link>
            <button className="btn-ghost" onClick={reset}>Upload another day</button>
          </div>
        </div>
      )}

      {/* ---------- the three files ---------- */}
      {!done && (
        <div className="space-y-3">
          {FILES.map(([key, label, hint, required]) => (
            <section key={key} className={'card p-4 ' + (files[key] ? 'border-good/40' : '')}>
              <div className="flex items-start gap-2.5">
                <span className={'grid h-6 w-6 shrink-0 place-items-center rounded-full text-2xs font-bold ' +
                  (files[key] ? 'bg-good text-white' : 'bg-paper text-slate2')}>
                  {files[key] ? '✓' : FILES.findIndex(f => f[0] === key) + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {label}{required && <span className="ml-1 text-bad">*</span>}
                  </div>
                  <div className="text-2xs text-slate2">{hint}</div>

                  <input ref={inputs[key]} type="file" accept=".xls,.xlsx"
                    className="mt-2 text-sm"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      setFiles(x => ({ ...x, [key]: f || undefined }))
                    }} />

                  {files[key] && (
                    <div className="mt-1 truncate text-2xs text-good">{files[key].name}</div>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {error && (
        <div className="card border-bad/30 bg-bad/[.04] p-4 text-sm text-bad">
          <div className="font-semibold">Could not read the files</div>
          <div className="mt-0.5">{error}</div>
        </div>
      )}

      {/* ---------- what was found ---------- */}
      {parsed && !done && (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">{parsed.branch} · {dt(parsed.date)}</div>
            <div className="text-2xs text-slate2">read from BILLWISE, not typed</div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="Bills" value={parsed.live} />
            <Cell label="Without tax" value={lakh(parsed.taxable)} />
            <Cell label="With tax" value={lakh(parsed.amount)} />
            <Cell label="Margin" value={parsed.itemTotal
              ? num(parsed.margin / parsed.itemTotal * 100, 1) + '%' : '—'} />
          </div>

          {/* the reconciliation */}
          <div className={'border-t border-line px-4 py-3 text-sm ' +
            (parsed.exact ? 'bg-good/10 text-good'
             : parsed.reconciled ? 'bg-gold2 text-gold'
             : 'bg-bad/10 text-bad')}>
            {parsed.exact ? (
              <>
                <strong>The files agree.</strong> Bill file and item file both give{' '}
                {inr(parsed.taxable)} without tax.
              </>
            ) : parsed.reconciled ? (
              <>
                <strong>{inr(Math.abs(parsed.variance))} apart — close enough.</strong>{' '}
                Bills say {inr(parsed.taxable)}, items say {inr(parsed.itemTotal)}.
                Under {inr(TOLERANCE)} is rounding on the tax split, so the upload can
                go ahead. The difference is recorded against the day.
              </>
            ) : (
              <>
                <strong>{inr(Math.abs(parsed.variance))} apart.</strong>{' '}
                Bills say {inr(parsed.taxable)}, items say {inr(parsed.itemTotal)} —
                that is {num(Math.abs(parsed.variance) / parsed.taxable * 100, 2)}% of
                the day. More than rounding, so it usually means one file was exported
                before closing. It will upload either way; please say what you know
                below so the figure is not a mystery next month.
              </>
            )}
          </div>

          {Math.abs(parsed.variance) > 1 && (
            <div className="border-t border-line p-4">
              <label>
                Note about the difference
                {Math.abs(parsed.variance) > TOLERANCE && <span className="ml-1 text-bad">*</span>}
              </label>
              <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
                placeholder="Item file exported at 4pm, before the last few bills" />
              <p className="mt-1 text-2xs text-slate2">
                Stored with the day. The measured difference is recorded automatically
                whether or not you add anything.
              </p>
            </div>
          )}

          {locked && (
            <div className="border-t border-line bg-gold2 px-4 py-3 text-sm text-gold">
              <strong>This day is already uploaded.</strong> To load it again, find it in
              the list below and unlock it first.
            </div>
          )}

          <div className="border-t border-line p-4">
            <button className="btn-dark w-full"
              disabled={busy || locked ||
                        (Math.abs(parsed.variance) > TOLERANCE && !note.trim())}
              onClick={upload}>
              {busy ? 'Uploading…'
                : locked ? 'Already uploaded'
                : (Math.abs(parsed.variance) > TOLERANCE && !note.trim())
                  ? 'Add a note about the difference first'
                  : `Upload ${parsed.live} bills and ${parsed.items.length} barcodes`}
            </button>
          </div>
        </div>
      )}

      {/* ---------- what has been uploaded ---------- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Uploaded so far</h2>
        {status.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate2">Nothing uploaded yet.</div>
        ) : (
          <ul className="card divide-y divide-line">
            {status.map(r => (
              <li key={r.branch_code + r.sale_date}
                className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Switch on={r.locked} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {r.branch_code} · {dt(r.sale_date)}
                  </span>
                  <span className="block text-2xs text-slate2">
                    {r.bills} bills · {inr(r.taxable)} without tax · {r.barcode_rows} barcodes
                    {r.uploaded_by_name && ' · ' + r.uploaded_by_name}
                    {r.gap !== 'exact' && ' · ' + inr(Math.abs(r.variance)) + ' apart'}
                  </span>
                  {r.note && (
                    <span className="mt-0.5 block text-2xs text-gold">{r.note}</span>
                  )}
                </span>
                <button className="btn-ghost btn-sm !text-bad"
                  onClick={() => { setClearing(r); setClearWhy('') }}>
                  Clear this day
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-2xs text-slate2">
          A green switch means that day is in and locked. Loading the same day twice is
          how a month's figures double, so clearing one needs a reason and is recorded.
        </p>
      </section>

      {clearing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
          onClick={() => setClearing(null)}>
          <div className="safe-b w-full max-w-md rounded-t-xl bg-white p-5 shadow-pop md:rounded-xl"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold">
              Clear {clearing.branch_code} · {dt(clearing.sale_date)}
            </h2>
            <p className="mt-1 text-sm text-slate2">
              Everything for that day goes: {clearing.bills} bills,
              {' '}{clearing.barcode_rows} barcodes, {clearing.person_rows} salesmen,
              {' '}{inr(clearing.taxable)} without tax.
            </p>

            <div className="mt-3 rounded-md bg-bad/[.06] px-3 py-2.5 text-xs text-bad">
              The reports will show nothing for this day until you upload it again.
            </div>

            <div className="mt-3">
              <label>Why *</label>
              <textarea rows={2} value={clearWhy} autoFocus
                placeholder="Exported before closing, figures were short"
                onChange={e => setClearWhy(e.target.value)} />
              <p className="mt-1 text-2xs text-slate2">
                Kept with your name and the time.
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              <button className="btn-bad flex-1" disabled={busy || !clearWhy.trim()}
                onClick={doClear}>
                {busy ? 'Clearing' : 'Clear the day'}
              </button>
              <button className="btn-ghost" onClick={() => setClearing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Switch({ on }) {
  return (
    <span className={'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ' +
      (on ? 'bg-good' : 'bg-line2')}>
      <span className={'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition ' +
        (on ? 'translate-x-6' : 'translate-x-1')}
        style={{ height: 18, width: 18 }} />
    </span>
  )
}

function Cell({ label, value }) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
