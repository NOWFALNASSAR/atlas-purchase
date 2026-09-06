import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { db, inr, lakh, dt, num } from '../lib/db'
import { readZip, detectKind, detectShop, KIND_LABEL, dateInName, daysApart } from '../lib/zip'

/* ==================================================================
   BULK UPLOAD

   One zip, every shop.

   It shows what it found before writing anything. Ten shops is a lot
   to get wrong silently, and a file that went under the wrong shop is
   far more work to unpick than to check beforehand.

   Sales files are handled as a set. A BILLWISE without its ITEMWISE
   cannot be reconciled, and loading it alone would record a day that
   looks complete and has no item detail — so the pair is required.
   ================================================================== */

const BATCH = 200

export default function BulkUpload() {
  /* The same page serves Sales and Stock. ?only=sales ignores stock
     files in the zip and the other way round — so a zip holding
     everything can still be used from either menu without loading the
     half you did not come for. */
  const [params] = useSearchParams()
  const only = params.get('only')             // 'sales' | 'stock' | null

  const [aliases, setAliases] = useState([])
  const [shops, setShops] = useState([])
  const [groups, setGroups] = useState(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState(null)
  const [running, setRunning] = useState(false)
  const input = useRef()

  useEffect(() => { boot() }, [])

  async function boot() {
    const [a, s] = await Promise.all([
      db.from('shop_map').select('*'),
      db.from('shops').select('id,code,name').eq('active', true).order('name')
    ])
    setAliases(a.data || [])
    setShops(s.data || [])
  }

  /* ---------- reading ---------- */

  async function pick(file) {
    if (!file) return
    setError(null); setGroups(null); setResults(null); setReading(true)
    try {
      const entries = await readZip(file)
      if (!entries.length) throw new Error('The zip has no files in it')

      const wanted = only === 'sales' ? ['bill', 'item', 'salesman']
                   : only === 'stock' ? ['stock']
                   : ['bill', 'item', 'salesman', 'stock']

      const kept = [], ignoredKind = []
      for (const e of entries) {
        const kind = detectKind(e.base)
        if (!kind) { kept.push({ ...e, kind: null }); continue }
        if (!wanted.includes(kind)) { ignoredKind.push(e); continue }
        /* The folder counts as much as the file name. Ten shops each
           exporting BILLWISE.xlsx can only sit in one zip inside
           folders — NILAMBUR/BILLWISE.xlsx — and matching on the base
           name alone made all ten look identical.

           The folder is also what keeps a shop's ITEMWISE with its own
           BILLWISE. Matching those on date alone would happily pair
           one shop's items with another shop's bills, which is the
           kind of wrong that looks perfectly fine on screen. */
        const dir = e.name.includes('/') ? e.name.slice(0, e.name.lastIndexOf('/')) : ''
        kept.push({ ...e, kind, dir,
                    nameDate: dateInName(e.base) || dateInName(dir),
                    nameShop: detectShop(e.base, aliases) || detectShop(dir, aliases) })
      }

      /* ------------------------------------------------------------
         A zip can hold several days. Grouping by shop alone treated
         the second BILLWISE as a duplicate and threw it away, so only
         one day of a week ever loaded.

         Each BILLWISE names its own branch AND its own date, so every
         bill file starts a group. The item and salesman files are then
         matched to it — by shop where the name says, and by date
         within a day, because the export is usually taken the morning
         after the trading it describes.
         ------------------------------------------------------------ */

      const groups = []

      for (const e of kept.filter(x => x.kind === 'bill')) {
        let shop = e.nameShop, date = null, clash = null
        try {
          const rows = sheetOf(e.data, false)
          const branch = String(rows[0]?.BranchName ?? '').trim()
          date = billDate(rows[0]?.Date)
          if (branch) {
            const hit = aliases.find(a => a.label.toUpperCase() === branch.toUpperCase())
            const fromFile = hit?.shop_name || branch

            /* The file's own branch wins — it is what was billed. But
               if the folder says something else, that is worth saying:
               a file copied into the wrong folder is otherwise
               invisible, and the figures would land under a shop that
               did not earn them. */
            if (shop && shop.toLowerCase() !== fromFile.toLowerCase()) {
              clash = { folder: shop, file: fromFile }
            }
            shop = fromFile
          }
        } catch { /* the person can pick it */ }
        groups.push({ shop, date, dir: e.dir, clash,
                      shopFrom: e.dir ? `the ${e.dir} folder` : 'the BILLWISE file itself',
                      files: { bill: e }, unknown: [], extras: [] })
      }

      const claim = (kind) => {
        for (const e of kept.filter(x => x.kind === kind)) {
          let candidates = groups.filter(g => !g.files[kind])

          /* Same folder wins outright. Only when there are no folders
             does this fall back to shop name and then to date. */
          const sameDir = candidates.filter(g => e.dir && g.dir === e.dir)
          if (sameDir.length) candidates = sameDir
          else candidates = candidates.filter(g => !e.nameShop || !g.shop ||
                              e.nameShop.toLowerCase() === g.shop.toLowerCase())

          candidates = candidates
            .sort((a, b) => daysApart(e.nameDate, a.date) - daysApart(e.nameDate, b.date))

          const best = candidates[0]
          if (!best) { (groups[0] || { extras: [] }).extras?.push(e); continue }
          if (e.nameDate && best.date && daysApart(e.nameDate, best.date) > 1
              && candidates.length > 1) {
            best.extras.push(e)
          } else {
            best.files[kind] = e
          }
        }
      }
      claim('item')
      claim('salesman')

      /* Stock files stand alone — a snapshot is not tied to a trading
         day. One per shop; a second for the same shop is the newer of
         the two, since a snapshot replaces rather than adds. */
      for (const e of kept.filter(x => x.kind === 'stock')) {
        const shop = e.nameShop
        const existing = groups.find(g => g.stockFile && g.shop &&
                                     shop && g.shop.toLowerCase() === shop.toLowerCase())
        if (existing) { existing.extras.push(e); continue }
        const g = groups.find(x => x.shop && shop &&
                              x.shop.toLowerCase() === shop.toLowerCase() && !x.files.stock)
        if (g) g.files.stock = e
        else groups.push({ shop, date: null, files: { stock: e }, unknown: [], extras: [] })
      }

      for (const e of kept.filter(x => x.kind === null)) {
        (groups[0] || groups[groups.push({ shop: null, files: {}, unknown: [], extras: [] }) - 1])
          .unknown.push(e)
      }

      const g = groups.map(x => ({
        ...x,
        skipped: ignoredKind.length,
        hasSales: !!(x.files.bill && x.files.item),
        hasStock: !!x.files.stock,
        salesIncomplete: !!x.files.bill !== !!x.files.item
      })).sort((a, b) => (a.shop || '').localeCompare(b.shop || '') ||
                          String(a.date).localeCompare(String(b.date)))

      setGroups(g.map(x => ({ ...x, include: x.hasSales || x.hasStock })))
    } catch (e) {
      setError(e.message)
    }
    setReading(false)
  }

  const setShopFor = (i, shopName) =>
    setGroups(gs => gs.map((g, j) => j === i ? { ...g, shop: shopName } : g))

  const toggle = i =>
    setGroups(gs => gs.map((g, j) => j === i ? { ...g, include: !g.include } : g))

  /* ---------- the shared bits of reading a sheet ---------- */

  const num0 = v => {
    const x = Number(String(v ?? '').replace(/,/g, ''))
    return Number.isFinite(x) ? x : 0
  }

  function sheetOf(bytes, asArray) {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true })
    // find the sheet and row the headers are actually on
    for (const name of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false })
      for (let i = 0; i < Math.min(grid.length, 15); i++) {
        const head = (grid[i] || []).map(c => String(c ?? '').trim())
        if (!head.some(h => h)) continue
        if (asArray) return grid.slice(i)
        const keys = head.map(h => h.replace(/\s+/g, ''))
        if (!keys.some(k => k)) continue
        return grid.slice(i + 1)
          .map(r => Object.fromEntries(keys.map((k, j) => [k, r[j]])))
          .filter(r => Object.values(r).some(v => v !== undefined && v !== ''))
      }
    }
    return []
  }

  /* ---------- writing ---------- */

  async function run() {
    setRunning(true); setError(null)
    const out = []

    const queue = groups.filter(x => x.include && x.shop)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

    for (const g of queue) {
      try {
        if (g.hasStock) {
          setProgress(`${g.shop} — reading the stock file`)
          const r = await loadStock(g)
          out.push({ shop: g.shop, what: 'Stock', ...r })
        }
        if (g.hasSales) {
          setProgress(`${g.shop} — reading the sales files`)
          const r = await loadSales(g)
          out.push({ shop: g.shop, what: 'Sales', ...r })
        }
      } catch (e) {
        out.push({ shop: g.shop, what: g.hasStock ? 'Stock' : 'Sales',
                   ok: false, message: e.message })
      }
      setResults([...out])
    }

    /* Stored results, refreshed once at the end rather than after
       every shop — ten refreshes of the same thing would treble the
       time for no benefit. */
    if (out.some(r => r.ok)) {
      setProgress('Updating the item and supplier lists…')
      await db.rpc('refresh_item_views')
    }

    setProgress(null)
    setRunning(false)
    setResults(out)
  }

  async function loadStock(g) {
    const rows = sheetOf(g.files.stock.data, false)
    const body = rows.filter(r => String(r.BarCode ?? '').trim() !== '')
    if (!body.length) throw new Error('No barcodes found in the stock file')

    const merged = new Map()
    for (const r of body) {
      const key = `${r.BarCode}|${r.PurRefNo}`
      const prev = merged.get(key)
      if (!prev) merged.set(key, { ...r, Qty: num0(r.Qty), Stock: num0(r.Stock), Amount: num0(r.Amount) })
      else { prev.Qty += num0(r.Qty); prev.Stock += num0(r.Stock); prev.Amount += num0(r.Amount) }
    }
    const all = [...merged.values()]
    const withStock = all.filter(r => r.Stock > 0)

    const shopRow = shops.find(s => (s.name || '').toLowerCase() === g.shop.toLowerCase())
    const code = (shopRow?.code || g.shop).toUpperCase()
    const today = new Date().toISOString().slice(0, 10)

    // one upload per shop per day
    const { data: exists } = await db.from('stock_snapshots').select('id')
      .eq('taken_on', today).eq('shop_code', code).maybeSingle()
    if (exists) return { ok: false, message: 'already uploaded today — clear it first' }

    let n = 0
    for (let i = 0; i < all.length; i += BATCH) {
      const part = all.slice(i, i + BATCH)
      const { error } = await db.from('barcodes').upsert(part.map(r => ({
        barcode: String(r.BarCode).trim(),
        item_code: num0(r.ItemCode) || null,
        item_name: String(r.Item ?? '').trim(),
        supplier_code: num0(r.SupCode) || null,
        supplier_label: r.Supplier ? String(r.Supplier).trim() : null,
        division_code: num0(r.DiviCode) || null,
        purchase_ref: num0(r.PurRefNo) || null,
        arrival_date: asDate(r.Arrival),
        qty_received: r.Qty,
        unit_cost: r.Stock > 0 ? r.Amount / r.Stock : 0,
        sale_price: num0(r.SalePrice),
        purchase_type: purchaseType(r.Colour)
      })), { onConflict: 'barcode,purchase_ref' })
      if (error) throw error
      n += part.length
      setProgress(`${g.shop} — barcodes ${n.toLocaleString('en-IN')} of ${all.length.toLocaleString('en-IN')}`)
    }

    const pieces = withStock.reduce((s, r) => s + r.Stock, 0)
    const value = withStock.reduce((s, r) => s + r.Amount, 0)

    const { data: snap, error: se } = await db.from('stock_snapshots').insert({
      taken_on: today, source_file: g.files.stock.base,
      shop_id: shopRow?.id || null, shop_code: code,
      rows_loaded: withStock.length, total_pieces: pieces, total_value: value
    }).select().single()
    if (se) throw se

    n = 0
    for (let i = 0; i < withStock.length; i += BATCH) {
      const part = withStock.slice(i, i + BATCH)
      const { error } = await db.from('stock_lines').insert(part.map(r => ({
        snapshot_id: snap.id, shop_id: shopRow?.id || null, shop_code: code,
        barcode: String(r.BarCode).trim(),
        purchase_ref: num0(r.PurRefNo) || null,
        item_code: num0(r.ItemCode) || null,
        item_name: String(r.Item ?? '').trim(),
        supplier_code: num0(r.SupCode) || null,
        division_code: num0(r.DiviCode) || null,
        qty_received: r.Qty, qty_on_hand: r.Stock,
        stock_pct: r.Qty > 0 ? (r.Stock / r.Qty * 100) : 0,
        value_at_cost: r.Amount,
        unit_cost: r.Stock > 0 ? r.Amount / r.Stock : 0,
        sale_price: num0(r.SalePrice),
        arrival_date: asDate(r.Arrival),
        days_held: num0(r.NoofDays),
        purchase_type: purchaseType(r.Colour)
      })))
      if (error) throw error
      n += part.length
      setProgress(`${g.shop} — stock rows ${n.toLocaleString('en-IN')} of ${withStock.length.toLocaleString('en-IN')}`)
    }

    return { ok: true, message: `${withStock.length.toLocaleString('en-IN')} rows, ${lakh(value)}`,
             zeroStock: all.length - withStock.length }
  }

  async function loadSales(g) {
    const bills = sheetOf(g.files.bill.data, false)
    if (!bills.length) throw new Error('BILLWISE has no rows')

    const date = billDate(bills[0].Date)
    const branch = String(bills[0].BranchName ?? '').trim()
    if (!date) throw new Error('Could not read the date from BILLWISE')

    const { data: exists } = await db.from('sales_uploads').select('id')
      .eq('branch_code', branch).eq('sale_date', date).maybeSingle()
    if (exists) return { ok: false, message: `${dt(date)} already uploaded — clear it first` }

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

    const rows = sheetOf(g.files.item.data, true)
    const items = rows.slice(1, -1)
      .map(r => ({ barcode: String(r[0] ?? '').trim(), qty: num0(r[1]), value: num0(r[2]),
                   cost: num0(r[4]), margin: num0(r[5]), discount: num0(r[9]) }))
      .filter(r => r.barcode)

    const itemTotal = items.reduce((s, r) => s + r.value, 0)
    const variance = Math.round((itemTotal - taxable) * 100) / 100

    let people = []
    if (g.files.salesman) {
      const sm = sheetOf(g.files.salesman.data, true)
      people = sm.slice(1, -1).map(r => {
        const d = String(r[0] ?? '').trim()
        const sp = d.indexOf(' ')
        return { code: sp > 0 ? d.slice(0, sp) : d, name: sp > 0 ? d.slice(sp + 1).trim() : null,
                 qty: num0(r[1]), value: num0(r[2]), bills: num0(r[3]) }
      }).filter(r => r.code)
    }

    const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

    for (const part of chunks(billRows, BATCH)) {
      const { error } = await db.from('sales_bills').insert(part.map(({ b, c, cancelled, slabs, tx, vt }) => ({
        bill_date: date, branch_code: branch,
        bill_no: String(b.No ?? '').trim(), invoice_no: b.InvNo ? String(b.InvNo) : null,
        customer_raw: b.Customer ? String(b.Customer) : null,
        customer_name: c.name, customer_phone: c.phone,
        amount: num0(b.Amount), taxable: tx, tax_total: vt, exempted: num0(b.Exempted),
        amt3: slabs[0][0], vat3: slabs[0][1], amt5: slabs[1][0], vat5: slabs[1][1],
        amt12: slabs[2][0], vat12: slabs[2][1], amt18: slabs[3][0], vat18: slabs[3][1],
        amt28: slabs[4][0], vat28: slabs[4][1], amt40: slabs[5][0], vat40: slabs[5][1],
        cancelled, user_code: b.UserCode ? String(b.UserCode) : null
      })))
      if (error) throw error
    }

    for (const part of chunks(items, 300)) {
      const { error } = await db.from('sales_barcode_daily').insert(part.map(r => ({
        sale_date: date, branch_code: branch, barcode: r.barcode,
        qty: r.qty, value_extax: r.value, cost: r.cost, margin: r.margin, discount: r.discount
      })))
      if (error) throw error
    }

    if (people.length) {
      await db.from('sales_person_daily').insert(people.map(r => ({
        sale_date: date, branch_code: branch, person_code: r.code, person_name: r.name,
        qty: r.qty, value_extax: r.value, bills: Math.round(r.bills),
        is_returns_counter: r.value < 0
      })))
    }

    await db.from('sales_uploads').insert({
      sale_date: date, branch_code: branch, bills: live,
      amount, taxable, tax_total: tax,
      cost: items.reduce((s, r) => s + r.cost, 0),
      margin: items.reduce((s, r) => s + r.margin, 0),
      discount: items.reduce((s, r) => s + r.discount, 0),
      qty: items.reduce((s, r) => s + r.qty, 0),
      reconciled: Math.abs(variance) <= 1, variance,
      note: Math.abs(variance) > 1
        ? `Bill file and item file ${inr(Math.abs(variance))} apart (loaded in bulk).` : null,
      locked: true, source: 'bulk'
    })

    await db.rpc('relink_sales', { p_from: date })

    return { ok: true,
             message: `${dt(date)} · ${live} bills · ${lakh(taxable)}` +
                      (Math.abs(variance) > 1 ? ` · files ${inr(Math.abs(variance))} apart` : ''),
             variance }
  }

  /* ---------- small helpers ---------- */

  const REAL_COLOURS = new Set(['CREAM', 'DARK CREAM'])
  const purchaseType = v => {
    const t = String(v ?? '').trim().toUpperCase()
    return (!t || t === 'NA' || REAL_COLOURS.has(t)) ? 'Non CC' : t
  }
  const asDate = v => {
    if (!v) return null
    const d = v instanceof Date ? v : new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const billDate = v => {
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{2})/)
    return m ? `20${m[3]}-${m[2]}-${m[1]}` : null
  }
  const WALK_IN = new Set(['GENERAL', 'CASH', 'CUSTOMER', 'C', '-'])
  const customer = raw => {
    const s = String(raw ?? '').replace(/,+$/, '').replace(/^,+/, '').trim()
    if (!s || WALK_IN.has(s.toUpperCase())) return { name: null, phone: null }
    const phone = (s.match(/(\d{10})/) || [])[1] || null
    let name = s.replace(/\d{10}/, '').replace(/[-,\s]+$/, '').replace(/^[-,\s]+/, '').trim()
    if (!name || WALK_IN.has(name.toUpperCase())) name = null
    return { name, phone }
  }

  /* ---------- render ---------- */

  const ready = (groups || []).filter(g => g.include && g.shop)

  return (
    <div className="page page-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">
          {only === 'sales' ? 'Upload a zip of sales'
            : only === 'stock' ? 'Upload a zip of stock files'
            : 'Upload everything at once'}
        </h1>
        <p className="text-sm text-slate2">
          {only === 'sales'
            ? "One zip holding BILLWISE, ITEMWISE and SALESMANWISE for every shop. Stock files in the same zip are ignored here."
            : only === 'stock'
              ? "One zip holding every shop's stock analysis file. Sales files in the same zip are ignored here."
              : "One zip holding every shop's files, stock and sales together."}
          {' '}It shows what it found before writing anything.
        </p>
      </div>

      {!groups && !results && (
        <section className="card p-4">
          <label>Zip file</label>
          <input ref={input} type="file" accept=".zip" className="text-sm"
            onChange={e => pick(e.target.files?.[0])} />
          <p className="mt-2 text-2xs text-slate2">
            {only === 'sales'
              ? 'BILLWISE and ITEMWISE are both needed — they are checked against each other. SALESMANWISE is optional.'
              : only === 'stock'
                ? 'One stock analysis file per shop.'
                : 'Stock analysis files, and BILLWISE with ITEMWISE and SALESMANWISE.'}
            {' '}The shop is read from the file name, or from inside BILLWISE where the
            name does not say. A file that cannot be placed is listed rather than
            guessed at.
          </p>
          {reading && <div className="mt-3 text-sm text-slate2">Reading the zip…</div>}
        </section>
      )}

      {error && (
        <div className="card border-bad/30 bg-bad/[.04] p-4 text-sm text-bad">
          <div className="font-semibold">Could not read the zip</div>
          <div className="mt-0.5">{error}</div>
        </div>
      )}

      {/* ---------- what was found ---------- */}
      {groups && !results && (
        <>
          <ul className="card divide-y divide-line">
            {groups.map((g, i) => (
              <li key={i} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <input type="checkbox" checked={g.include} onChange={() => toggle(i)}
                    className="mt-1 h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    {g.shop ? (
                      <div>
                        <div className="text-sm font-semibold">
                          {g.shop}
                          {g.date && (
                            <span className="ml-2 font-normal text-slate2">{dt(g.date)}</span>
                          )}
                        </div>
                        {g.shopFrom && (
                          <div className="text-2xs text-slate2">read from {g.shopFrom}</div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="text-sm font-semibold text-gold">
                          Which shop is this?
                        </div>
                        <select className="mt-1 !w-auto" value=""
                          onChange={e => setShopFor(i, e.target.value)}>
                          <option value="">Choose the shop</option>
                          {shops.map(s => (
                            <option key={s.id} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <ul className="mt-1.5 space-y-0.5">
                      {Object.entries(g.files).map(([kind, e]) => (
                        <li key={kind} className="text-2xs text-slate2">
                          <span className="font-medium text-ink">{KIND_LABEL[kind]}</span>
                          {' — '}{e.base}
                          {' · '}{Math.round(e.usize / 1024).toLocaleString('en-IN')} kB
                        </li>
                      ))}
                      {g.unknown.map((e, j) => (
                        <li key={'u' + j} className="text-2xs text-gold">
                          not recognised, will be skipped — {e.base}
                        </li>
                      ))}
                      {g.extras.map((e, j) => (
                        <li key={'x' + j} className="text-2xs text-gold">
                          a second file of the same kind, will be skipped — {e.base}
                        </li>
                      ))}
                    </ul>

                    {g.clash && (
                      <p className="mt-1.5 text-2xs text-bad">
                        The folder is named {g.clash.folder} but the file inside says
                        {' '}{g.clash.file}. Loading it as {g.clash.file}, which is what
                        was billed — check the file is in the right folder.
                      </p>
                    )}

                    {g.skipped > 0 && (
                      <p className="mt-1 text-2xs text-slate2">
                        {g.skipped} file{g.skipped > 1 ? 's' : ''} of the other kind in
                        this zip, ignored on this page.
                      </p>
                    )}

                    {g.salesIncomplete && (
                      <p className="mt-1.5 text-2xs text-bad">
                        Only one of BILLWISE and ITEMWISE is here. Sales need both — the
                        two are checked against each other — so the sales part will be
                        skipped.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    {g.hasStock && <span className="tag bg-ink/10">stock</span>}
                    {g.hasSales && <span className="tag bg-gold2 text-gold">sales</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="card p-4">
            {progress && (
              <div className="mb-3 rounded-md bg-paper px-3 py-2.5 text-sm text-slate2">
                {progress}
              </div>
            )}
            <button className="btn-dark w-full" disabled={running || ready.length === 0}
              onClick={run}>
              {(() => {
                if (running) return 'Uploading…'
                if (ready.length === 0) return 'Nothing ready to upload'
                const shops = new Set(ready.map(r => r.shop)).size
                const days = new Set(ready.filter(r => r.date).map(r => r.date)).size
                const bits = [`${shops} shop${shops === 1 ? '' : 's'}`]
                if (days > 1) bits.push(`${days} days`)
                const label = `Upload ${bits.join(', ')}`
                return ready.length > shops ? `${label} — ${ready.length} in all` : label
              })()}
            </button>
            <p className="mt-2 text-center text-2xs text-slate2">
              Each shop-day is loaded separately, oldest first. Ten of them takes
              several minutes — leave the page open, closing it stops the upload part
              way through.
            </p>
          </div>
        </>
      )}

      {/* ---------- what happened ---------- */}
      {results && (
        <>
          <ul className="card divide-y divide-line">
            {results.map((r, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <span className={'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs ' +
                  (r.ok ? 'bg-good text-white' : 'bg-bad text-white')}>
                  {r.ok ? '✓' : '!'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{r.shop} · {r.what}</span>
                  <span className="block text-2xs text-slate2">{r.message}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Link to="/" className="btn-dark flex-1 text-center">Dashboard</Link>
            <button className="btn-ghost" onClick={() => {
              setGroups(null); setResults(null)
              if (input.current) input.current.value = ''
            }}>
              Upload another zip
            </button>
          </div>
        </>
      )}
    </div>
  )
}
