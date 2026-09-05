import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { db, inr, lakh, dt, num } from '../lib/db'

/* ==================================================================
   STOCK UPLOAD

   One shop's stock analysis file at a time.

   Two things this does that a naive loader would not:

   Every barcode is kept, whether or not it has stock. The barcodes
   table is what classifies a sale — its division, supplier and item.
   Only rows WITH stock become stock figures. A zero-stock row is not
   stock, and would drag every stock report down with rows worth
   nothing.

   Each shop is its own snapshot. Without that, every file is stored as
   "no shop", they collide on the one-per-day rule, and each upload
   silently deletes the one before it. Nine shops, one survivor, no
   error.
   ================================================================== */

const BATCH = 500

export default function StockUpload() {
  const [file, setFile] = useState(null)
  const [shop, setShop] = useState('')
  const [shops, setShops] = useState([])
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [done, setDone] = useState(null)
  const [recent, setRecent] = useState([])

  useEffect(() => { boot() }, [])

  async function boot() {
    const [sh, snaps] = await Promise.all([
      db.from('shops').select('id,code,name').eq('active', true).order('name'),
      db.from('v_stock_snapshots_status').select('*').limit(30)
    ])
    setShops(sh.data || [])
    setRecent(snaps.data || [])
  }

  const num0 = v => {
    const x = Number(String(v ?? '').replace(/,/g, ''))
    return Number.isFinite(x) ? x : 0
  }

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

  async function read(f) {
    setError(null); setParsed(null); setDone(null)
    try {
      // Uint8Array, not a bare ArrayBuffer — the browser build of
      // SheetJS reads an ArrayBuffer as text
      const buf = new Uint8Array(await f.arrayBuffer())
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      if (!rows.length) throw new Error('The sheet has no rows')
      if (!('BarCode' in rows[0])) {
        throw new Error('No BarCode column. Is this a stock analysis export?')
      }

      /* the same batch can appear on more than one row, split by
         quantity — added together, not dropped */
      const merged = new Map()
      for (const r of rows) {
        const key = `${r.BarCode}|${r.PurRefNo}`
        const prev = merged.get(key)
        if (!prev) {
          merged.set(key, { ...r, Qty: num0(r.Qty), Stock: num0(r.Stock), Amount: num0(r.Amount) })
        } else {
          prev.Qty += num0(r.Qty); prev.Stock += num0(r.Stock); prev.Amount += num0(r.Amount)
        }
      }
      const all = [...merged.values()]
      const withStock = all.filter(r => r.Stock > 0)

      const pieces = withStock.reduce((s, r) => s + r.Stock, 0)
      const value = withStock.reduce((s, r) => s + r.Amount, 0)

      setParsed({
        all, withStock, merged: rows.length - all.length,
        zeroStock: all.length - withStock.length,
        pieces, value,
        divisions: [...new Set(all.map(r => Number(r.DiviCode)).filter(Number.isFinite))],
        types: [...new Set(all.map(r => purchaseType(r.Colour)))]
      })
    } catch (e) {
      setError(e.message)
    }
  }

  async function upload() {
    if (!parsed || !shop) return
    setBusy(true); setError(null)
    const p = parsed
    const shopRow = shops.find(s => s.id === shop)
    const code = (shopRow?.code || shopRow?.name || '').toUpperCase()

    try {
      setProgress('Clearing the previous file for this shop…')
      await db.from('stock_snapshots').delete()
        .eq('taken_on', new Date().toISOString().slice(0, 10)).eq('shop_id', shop)

      setProgress('Making room for new divisions and purchase types…')
      if (p.divisions.length) {
        await db.from('divisions').upsert(
          p.divisions.map(d => ({ code: d, name: 'Division ' + d, sort_order: d })),
          { onConflict: 'code', ignoreDuplicates: true })
      }
      await db.from('purchase_types').upsert(
        p.types.map(t => ({ code: t, label: t, sort_order: 50 })),
        { onConflict: 'code', ignoreDuplicates: true })

      // every barcode, stock or not — this is what classifies a sale
      let n = 0
      for (let i = 0; i < p.all.length; i += BATCH) {
        const part = p.all.slice(i, i + BATCH)
        const { error } = await db.from('barcodes').upsert(part.map(r => ({
          barcode: String(r.BarCode).trim(),
          item_code: num0(r.ItemCode) || null,
          item_name: String(r.Item ?? '').trim(),
          supplier_code: num0(r.SupCode) || null,
          supplier_label: r.Supplier ? String(r.Supplier).trim() : null,
          division_code: num0(r.DiviCode) || null,
          brand_code: num0(r.BrandCode) || null,
          brand_name: r.BrandName ? String(r.BrandName) : null,
          purchase_ref: num0(r.PurRefNo) || null,
          arrival_date: asDate(r.Arrival),
          qty_received: r.Qty,
          unit_cost: r.Stock > 0 ? r.Amount / r.Stock : 0,
          sale_price: num0(r.SalePrice),
          sale_price_disc: num0(r.SelRateAfterDisc),
          size: r.Size ? String(r.Size) : null,
          purchase_type: purchaseType(r.Colour),
          design: r.Design ? String(r.Design) : null
        })), { onConflict: 'barcode,purchase_ref' })
        if (error) throw error
        n += part.length
        setProgress(`Barcodes ${n.toLocaleString('en-IN')} of ${p.all.length.toLocaleString('en-IN')}…`)
      }

      setProgress('Recording the stock snapshot…')
      const { data: snap, error: snapErr } = await db.from('stock_snapshots').insert({
        taken_on: new Date().toISOString().slice(0, 10),
        source_file: file.name, shop_id: shop, shop_code: code,
        rows_loaded: p.withStock.length, total_pieces: p.pieces, total_value: p.value
      }).select().single()
      if (snapErr) throw snapErr

      // only rows WITH stock become stock figures
      n = 0
      for (let i = 0; i < p.withStock.length; i += BATCH) {
        const part = p.withStock.slice(i, i + BATCH)
        const { error } = await db.from('stock_lines').insert(part.map(r => ({
          snapshot_id: snap.id, shop_id: shop, shop_code: code,
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
        setProgress(`Stock rows ${n.toLocaleString('en-IN')} of ${p.withStock.length.toLocaleString('en-IN')}…`)
      }

      setProgress('Classifying sales with what this file taught us…')
      const { data: relink } = await db.rpc('relink_sales', { p_from: null })

      setDone({ ...p, shop: shopRow?.name || code, relink: relink?.[0] || null })
      setProgress(null)
      boot()
    } catch (e) {
      setError(e.message)
      setProgress(null)
    }
    setBusy(false)
  }

  function reset() {
    setFile(null); setParsed(null); setDone(null); setError(null); setProgress(null)
  }

  return (
    <div className="page page-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Upload stock</h1>
        <p className="text-sm text-slate2">
          One shop's stock analysis file at a time. Every barcode is kept so sales can
          be classified; only rows with stock become stock figures.
        </p>
      </div>

      {done && (
        <div className="card overflow-hidden border-good">
          <div className="flex items-center gap-3 bg-good px-4 py-3 text-white">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-base">✓</span>
            <div>
              <div className="text-sm font-semibold">Upload finished</div>
              <div className="text-2xs text-white/80">{done.shop} · {dt(new Date())}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="Barcodes kept" value={done.all.length.toLocaleString('en-IN')} />
            <Cell label="With stock" value={done.withStock.length.toLocaleString('en-IN')} />
            <Cell label="Pieces" value={Math.round(done.pieces).toLocaleString('en-IN')} />
            <Cell label="Stock value" value={lakh(done.value)} />
          </div>
          {done.relink && (
            <div className="border-t border-line bg-paper px-4 py-3 text-sm">
              <strong>{Number(done.relink.rows_updated).toLocaleString('en-IN')}</strong> older
              sales rows just got their division and supplier from this file.
              {Number(done.relink.still_unclassified) > 0 && (
                <span className="text-slate2">
                  {' '}{Number(done.relink.still_unclassified).toLocaleString('en-IN')} still
                  unclassified, worth {inr(done.relink.value_unclassified)}.
                </span>
              )}
            </div>
          )}
          <div className="flex gap-2 border-t border-line p-4">
            <Link to="/stock/reports" className="btn-dark flex-1 text-center">Stock reports</Link>
            <button className="btn-ghost" onClick={reset}>Upload another shop</button>
          </div>
        </div>
      )}

      {!done && (
        <>
          <section className="card p-4">
            <label>Which shop is this file from *</label>
            <select value={shop} onChange={e => setShop(e.target.value)}>
              <option value="">Choose the shop</option>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="mt-1 text-2xs text-slate2">
              Each shop is stored separately. Without this they would overwrite each
              other and you would be left with one.
            </p>
          </section>

          <section className={'card p-4 ' + (file ? 'border-good/40' : '')}>
            <label>Stock analysis file *</label>
            <input type="file" accept=".xls,.xlsx" className="text-sm"
              onChange={e => {
                const f = e.target.files?.[0]
                setFile(f || null)
                if (f) read(f)
              }} />
            {file && <div className="mt-1 truncate text-2xs text-good">{file.name}</div>}
          </section>
        </>
      )}

      {error && (
        <div className="card border-bad/30 bg-bad/[.04] p-4 text-sm text-bad">
          <div className="font-semibold">Could not read the file</div>
          <div className="mt-0.5">{error}</div>
        </div>
      )}

      {parsed && !done && (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="Barcodes" value={parsed.all.length.toLocaleString('en-IN')} />
            <Cell label="With stock" value={parsed.withStock.length.toLocaleString('en-IN')} />
            <Cell label="Pieces" value={Math.round(parsed.pieces).toLocaleString('en-IN')} />
            <Cell label="Stock value" value={lakh(parsed.value)} />
          </div>

          {parsed.zeroStock > 0 ? (
            <div className="border-t border-line bg-good/10 px-4 py-3 text-sm text-good">
              <strong>{parsed.zeroStock.toLocaleString('en-IN')} barcodes at zero stock.</strong>{' '}
              Kept for classifying sales, left out of the stock figures. This is what a
              full export looks like.
            </div>
          ) : (
            <div className="border-t border-line bg-gold2 px-4 py-3 text-sm text-gold">
              <strong>Every row has stock.</strong> The export still has a "stock greater
              than zero" filter on it, so barcodes that have sold out are missing and
              their sales will stay unclassified. Worth asking your billing vendor to
              remove it.
            </div>
          )}

          {parsed.merged > 0 && (
            <div className="border-t border-line px-4 py-2.5 text-xs text-slate2">
              {parsed.merged} rows were the same batch split in two — added together
              rather than dropped.
            </div>
          )}

          <div className="border-t border-line p-4">
            {progress && (
              <div className="mb-3 rounded-md bg-paper px-3 py-2.5 text-sm text-slate2">
                {progress}
              </div>
            )}
            <button className="btn-dark w-full" disabled={busy || !shop} onClick={upload}>
              {busy ? 'Uploading…'
                : !shop ? 'Choose the shop first'
                : `Upload ${parsed.all.length.toLocaleString('en-IN')} barcodes`}
            </button>
            {parsed.all.length > 20000 && !busy && (
              <p className="mt-2 text-center text-2xs text-slate2">
                A file this size takes a minute or two. Leave the page open.
              </p>
            )}
          </div>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Stock loaded so far</h2>
        <p className="mb-2 text-2xs text-slate2">
          A green dot means the file counts towards stock value. A grey one means it is
          used to classify sales but not counted — otherwise a godown file and the
          branch files would count the same goods twice.
        </p>
        {recent.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate2">Nothing uploaded yet.</div>
        ) : (
          <ul className="card divide-y divide-line">
            {recent.map((r, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <span className={'h-2.5 w-2.5 shrink-0 rounded-full ' +
                  (r.counts_as_stock ? 'bg-good' : 'bg-line2')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {r.shop === '(no shop)' ? 'Company-wide / godown' : r.shop}
                    {' · '}{dt(r.taken_on)}
                  </span>
                  <span className="block truncate text-2xs text-slate2">
                    {Number(r.rows_loaded).toLocaleString('en-IN')} rows ·{' '}
                    {lakh(r.total_value)} · {r.source_file}
                  </span>
                  {!r.counts_as_stock && (
                    <span className="mt-0.5 block text-2xs text-gold">
                      Used to classify sales only — not added to the stock figures,
                      because the branch files already hold these goods.
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
