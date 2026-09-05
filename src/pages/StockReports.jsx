import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, lakh, inr, dt, num } from '../lib/db'

/* ==================================================================
   STOCK REPORTS

   Reads the data imported from the billing software — item_master,
   supplier_master, barcodes and stock_lines.

   The Item master and Supplier master tabs read `items` and
   `suppliers` — the same rows the purchase order screens use. Migration
   40 folded the uploaded masters into those tables rather than keeping
   a second set, so there is one master everywhere.
   ================================================================== */

const TABS = [
  ['overview',  'Overview'],
  ['ageing',    'Ageing'],
  ['division',  'Divisions'],
  ['type',      'Purchase type'],
  ['supplier',  'Suppliers'],
  ['dead',      'Dead stock'],
  ['slow',      'Slow movers'],
  ['spread',    'Price spread'],
  ['anomaly',   'Check these'],
  ['items',     'Item master'],
  ['suppliers', 'Supplier master']
]

export default function StockReports() {
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [snap, ageing, divi, ptype, sup, dead, slow, spread, anom, items, sups] =
        await Promise.all([
          db.from('stock_snapshots').select('*').order('taken_on', { ascending: false }).limit(1),
          db.from('v_stock_ageing').select('*').order('sort_order'),
          db.from('v_stock_by_division_now').select('*').order('value', { ascending: false }),
          db.from('v_stock_by_purchase_type').select('*').order('value', { ascending: false }),
          db.from('v_stock_by_supplier_now').select('*').order('value', { ascending: false }).limit(200),
          db.from('v_dead_barcodes').select('*').order('value_at_cost', { ascending: false }).limit(500),
          db.from('v_slow_movers').select('*').order('value_at_cost', { ascending: false }).limit(500),
          db.from('v_price_spread').select('*').order('value', { ascending: false }).limit(300),
          db.from('v_stock_anomalies').select('*').limit(200),
          // the unified master, the same rows purchase orders use
          db.from('items').select('*').eq('active', true).order('name').limit(500),
          db.from('suppliers').select('*').eq('active', true).order('name').limit(500)
        ])

      if (snap.error) throw snap.error

      setData({
        snapshot: (snap.data || [])[0],
        ageing: ageing.data || [], division: divi.data || [], ptype: ptype.data || [],
        supplier: sup.data || [], dead: dead.data || [], slow: slow.data || [],
        spread: spread.data || [], anomaly: anom.data || [],
        items: items.data || [], suppliers: sups.data || []
      })
      setFailed(null)
    } catch (e) {
      setFailed(e.message)
    }
    setLoading(false)
  }

  const totals = useMemo(() => {
    const a = data.ageing || []
    return {
      value: a.reduce((s, r) => s + Number(r.value || 0), 0),
      pieces: a.reduce((s, r) => s + Number(r.pieces || 0), 0),
      barcodes: a.reduce((s, r) => s + Number(r.barcodes || 0), 0),
      overYear: a.find(r => r.bucket === 'over a year')
    }
  }, [data.ageing])

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    const add = (name, rows) => rows?.length &&
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31))
    add('Ageing', data.ageing); add('Divisions', data.division)
    add('Purchase types', data.ptype); add('Suppliers', data.supplier)
    add('Dead stock', data.dead); add('Slow movers', data.slow)
    add('Price spread', data.spread); add('Check these', data.anomaly)
    XLSX.writeFile(wb, `Stock reports ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load the stock reports</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_stock_current or stock_lines, run
          supabase/38_item_barcode_stock.sql, then the import parts.
        </p>
      </div>
    </div>
  )

  const nothing = !loading && !data.snapshot

  return (
    <div className="page page-xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Stock reports</h1>
          <p className="text-sm text-slate2">
            {data.snapshot
              ? `From ${data.snapshot.source_file || 'the stock master'}, uploaded ${dt(data.snapshot.taken_on)}`
              : 'From the stock master exported by the billing software'}
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={exportExcel}>Excel</button>
      </div>

      {nothing && (
        <div className="card p-8 text-center">
          <div className="mb-1.5 text-base font-semibold">No stock loaded yet</div>
          <p className="text-sm text-slate2">
            Run <code className="rounded bg-paper px-1">38_item_barcode_stock.sql</code>,
            then the twelve import parts. This screen fills itself once
            stock_lines has rows.
          </p>
        </div>
      )}

      {loading ? <div className="card h-64 animate-pulse bg-line2" /> : !nothing && (
        <>
          <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="Stock value" value={lakh(totals.value)} feature />
            <Cell label="Pieces" value={Math.round(totals.pieces).toLocaleString('en-IN')} />
            <Cell label="Barcodes" value={totals.barcodes.toLocaleString('en-IN')} />
            <Cell label="Over a year old"
              value={totals.overYear ? num(totals.overYear.share_pct, 1) + '%' : '—'}
              bad={totals.overYear?.share_pct > 50} />
          </div>

          <div className="-mx-4 overflow-x-auto px-4">
            <div className="flex w-max gap-1 rounded-md bg-paper p-1">
              {TABS.map(([k, l]) => (
                <button key={k} onClick={() => { setTab(k); setQ('') }}
                  className={'whitespace-nowrap rounded px-3 py-1.5 text-sm font-semibold ' +
                    (tab === k ? 'bg-white text-ink shadow-card' : 'text-slate2')}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {tab === 'overview' && <Overview data={data} totals={totals} />}

          {tab === 'ageing' && (
            <Table head={['Age', 'Barcodes', 'Pieces', 'Value', 'Share']}
              rows={data.ageing.map(r => [
                r.bucket, r.barcodes, Math.round(r.pieces).toLocaleString('en-IN'),
                lakh(r.value), num(r.share_pct, 1) + '%'
              ])} align="lrrrr" highlight={r => r[0] === 'over a year'} />
          )}

          {tab === 'division' && (
            <Table head={['Division', 'Barcodes', 'Purchased', 'In stock', 'Value', 'Sell-through']}
              rows={data.division.map(r => [
                r.division, r.barcodes,
                Math.round(r.purchased).toLocaleString('en-IN'),
                Math.round(r.in_stock).toLocaleString('en-IN'),
                lakh(r.value), num(r.avg_sell_through, 1) + '%'
              ])} align="lrrrrr" />
          )}

          {tab === 'type' && (
            <Table head={['Purchase type', 'Barcodes', 'In stock', 'Value', 'Sell-through']}
              rows={data.ptype.map(r => [
                r.purchase_type, r.barcodes,
                Math.round(r.in_stock).toLocaleString('en-IN'),
                lakh(r.value), num(r.avg_sell_through, 1) + '%'
              ])} align="lrrrr" />
          )}

          {tab === 'supplier' && (
            <Searchable q={q} setQ={setQ} placeholder="Search supplier"
              rows={data.supplier} match={(r, t) => (r.supplier || '').toLowerCase().includes(t)}
              head={['Supplier', 'Barcodes', 'Pieces', 'Value', 'Sell-through', 'Oldest']}
              cells={r => [
                r.supplier, r.barcodes, Math.round(r.pieces).toLocaleString('en-IN'),
                lakh(r.value), num(r.avg_sell_through, 1) + '%',
                r.oldest_arrival ? dt(r.oldest_arrival) : '—'
              ]} align="lrrrrl" />
          )}

          {(tab === 'dead' || tab === 'slow') && (
            <Searchable q={q} setQ={setQ} placeholder="Search item or barcode"
              rows={tab === 'dead' ? data.dead : data.slow}
              match={(r, t) => (r.item_name || '').toLowerCase().includes(t) ||
                               String(r.barcode).toLowerCase().includes(t)}
              note={tab === 'dead'
                ? 'Barcodes that have not sold a single piece since arriving.'
                : 'Over 90 days old with less than a quarter sold.'}
              head={['Barcode', 'Item', 'Supplier', 'Bought', 'Left', 'Value', 'Days']}
              cells={r => [
                r.barcode, r.item_name, r.supplier_name || '—',
                Math.round(r.qty_received), Math.round(r.qty_on_hand),
                inr(r.value_at_cost), r.days_held
              ]} align="llrrrrr" />
          )}

          {tab === 'spread' && (
            <Searchable q={q} setQ={setQ} placeholder="Search item"
              rows={data.spread} match={(r, t) => (r.item_name || '').toLowerCase().includes(t)}
              note="The same product sitting at more than one selling price."
              head={['Item', 'Prices', 'Lowest', 'Highest', 'Pieces', 'Value']}
              cells={r => [
                r.item_name, r.price_points, inr(r.lowest), inr(r.highest),
                Math.round(r.pieces), lakh(r.value)
              ]} align="lrrrrr" />
          )}

          {tab === 'anomaly' && (
            <Searchable q={q} setQ={setQ} placeholder="Search item"
              rows={data.anomaly} match={(r, t) => (r.item_name || '').toLowerCase().includes(t)}
              note="More stock on hand than was ever purchased. That cannot be true — a stock adjustment posted without a purchase, or a barcode reused. Worth checking in the billing software."
              head={['Barcode', 'Item', 'Bought', 'On hand', 'Stock %', 'Value']}
              cells={r => [
                r.barcode, r.item_name, Math.round(r.qty_received),
                Math.round(r.qty_on_hand), num(r.stock_pct, 0) + '%', inr(r.value_at_cost)
              ]} align="llrrrr" />
          )}

          {tab === 'items' && (
            <Searchable q={q} setQ={setQ} placeholder="Search item name"
              rows={data.items} match={(r, t) => (r.name || '').toLowerCase().includes(t)}
              note="The single item master — the same rows the purchase order screens use. First 500 by name; search to narrow it."
              head={['Item', 'Code', 'Billing code', 'Unit', 'Tax %', 'Source']}
              cells={r => [r.name, r.code, r.billing_code ?? '—', r.unit || 'Nos',
                           num(r.tax_pct, 0) + '%', r.source === 'billing' ? 'billing software' : 'Atlas']}
              align="llllrl" />
          )}

          {tab === 'suppliers' && (
            <Searchable q={q} setQ={setQ} placeholder="Search supplier name or place"
              rows={data.suppliers}
              match={(r, t) => (r.name || '').toLowerCase().includes(t) ||
                               (r.place || '').toLowerCase().includes(t)}
              note="The single supplier master — the same rows purchase orders use."
              head={['Supplier', 'Place', 'Code', 'Mobile', 'Source']}
              cells={r => [r.name, r.place || '—', r.code, r.mobile || '—',
                           r.source === 'billing' ? 'billing software' : 'Atlas']}
              align="lllll" />
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Overview({ data, totals }) {
  const oldest = data.ageing?.find(r => r.bucket === 'over a year')
  const dead = data.dead || []
  const deadValue = dead.reduce((s, r) => s + Number(r.value_at_cost || 0), 0)

  return (
    <div className="space-y-4">
      {oldest && Number(oldest.share_pct) > 50 && (
        <div className="card border-bad/30 bg-bad/[.04] p-4">
          <div className="text-sm font-semibold text-bad">
            {num(oldest.share_pct, 1)}% of your stock value has been sitting over a year
          </div>
          <div className="mt-0.5 text-sm text-slate2">
            {lakh(oldest.value)} across {Number(oldest.barcodes).toLocaleString('en-IN')} barcodes
            and {Math.round(oldest.pieces).toLocaleString('en-IN')} pieces.
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Where the value sits" rows={(data.division || []).slice(0, 6).map(r =>
          [r.division, lakh(r.value), num(r.avg_sell_through, 0) + '% sold'])} />
        <Panel title="By purchase type" rows={(data.ptype || []).slice(0, 6).map(r =>
          [r.purchase_type, lakh(r.value), num(r.avg_sell_through, 0) + '% sold'])} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="stat-label">Never sold a piece</div>
          <div className="mt-1 text-2xl font-semibold">{lakh(deadValue)}</div>
          <div className="mt-0.5 text-xs text-slate2">
            {dead.length.toLocaleString('en-IN')} barcodes, showing the largest 500
          </div>
        </div>
        <div className="card p-4">
          <div className="stat-label">Needs checking</div>
          <div className="mt-1 text-2xl font-semibold">
            {(data.anomaly || []).length}
          </div>
          <div className="mt-0.5 text-xs text-slate2">
            more stock on hand than was ever purchased
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, rows }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">{title}</div>
      <ul className="divide-y divide-line">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{r[0]}</span>
            <span className="font-semibold">{r[1]}</span>
            <span className="w-20 text-right text-xs text-slate2">{r[2]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Table({ head, rows, align = '', highlight }) {
  if (!rows.length) return (
    <div className="card p-8 text-center text-sm text-slate2">Nothing here.</div>
  )
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr>{head.map((h, i) => (
            <th key={i} className={'px-3 py-2.5 ' +
              (align[i] === 'r' ? 'text-right' : 'text-left')}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={'border-t border-line ' +
              (highlight?.(r) ? 'bg-bad/[.04] font-semibold' : '')}>
              {r.map((c, j) => (
                <td key={j} className={'px-3 py-2.5 ' +
                  (align[j] === 'r' ? 'text-right' : '')}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Searchable({ q, setQ, placeholder, rows, match, head, cells, align, note }) {
  const shown = q.trim()
    ? rows.filter(r => match(r, q.trim().toLowerCase()))
    : rows
  return (
    <div className="space-y-2">
      {note && <p className="text-xs text-slate2">{note}</p>}
      <div className="flex items-center gap-3">
        <input placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} />
        <span className="whitespace-nowrap text-xs text-slate2">
          {shown.length.toLocaleString('en-IN')} rows
        </span>
      </div>
      <Table head={head} rows={shown.slice(0, 300).map(cells)} align={align} />
      {shown.length > 300 && (
        <p className="text-center text-2xs text-slate2">
          Showing the first 300. Narrow the search, or use the Excel export for all of it.
        </p>
      )}
    </div>
  )
}

function Cell({ label, value, feature, bad }) {
  return (
    <div className={'px-4 py-3 ' + (feature ? 'bg-ink text-white' : '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className={'text-xl font-semibold ' + (bad ? 'text-bad' : '')}>{value}</div>
    </div>
  )
}
