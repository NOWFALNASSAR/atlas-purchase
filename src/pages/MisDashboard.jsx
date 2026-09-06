import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, lakh, inr, num, dt } from '../lib/db'

/* ==================================================================
   MIS DASHBOARD

   CC and Non CC at the top, then down through purchase type, shop and
   division.

   The point is that every level shows stock, sales and margin
   TOGETHER. Asking "where is the problem" should be a matter of
   looking, not of running four reports and holding the numbers in your
   head while you compare them.

   Stock is what is on hand now. Sales are for the chosen dates. They
   are different things and the screen says so rather than letting the
   two be read as one figure.
   ================================================================== */

const LEVELS = ['group', 'type', 'shop', 'division']
const LABEL = { group: 'CC / Non CC', type: 'Purchase type', shop: 'Shop', division: 'Division' }

export default function MisDashboard() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [path, setPath] = useState([])            // where we have drilled to
  const [stock, setStock] = useState([])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  useEffect(() => { boot() }, [])
  useEffect(() => { if (from && to) load() }, [from, to])

  async function boot() {
    // default to the month the latest sales day falls in
    const { data } = await db.from('sales_uploads')
      .select('sale_date').order('sale_date', { ascending: false }).limit(1)
    const last = data?.[0]?.sale_date || new Date().toISOString().slice(0, 10)
    const d = new Date(last)
    setFrom(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10))
    setTo(last)
  }

  async function load() {
    setLoading(true)
    try {
      const [st, sa] = await Promise.all([
        db.from('v_stock_by_group').select('*'),
        db.from('v_sales_by_group').select('*').gte('sale_date', from).lte('sale_date', to)
      ])
      if (st.error) throw st.error
      if (sa.error) throw sa.error
      setStock(st.data || [])
      setSales(sa.data || [])
      setFailed(null)
    } catch (e) { setFailed(e.message) }
    setLoading(false)
  }

  /* ---------- which rows survive the drill-down so far ---------- */

  const keyOf = {
    group: r => r.purchase_group,
    type: r => r.purchase_type || 'Unclassified',
    /* Both sides must key on the same thing or one shop becomes two
       rows — stock carries shop_key, sales carry branch_code, and both
       are the uppercase code. r.shop is the pretty name and is only
       for display. */
    shop: r => (r.shop_key || r.branch_code || 'Not set').toUpperCase(),
    division: r => r.division || 'Unclassified'
  }

  const matches = (r, upto) => path.slice(0, upto).every((step, i) =>
    keyOf[LEVELS[i]](r) === step)

  const level = LEVELS[path.length] || 'division'
  const atBottom = path.length >= LEVELS.length

  const days = useMemo(() => {
    if (!from || !to) return 1
    return Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5) + 1)
  }, [from, to])

  const rows = useMemo(() => {
    const acc = new Map()
    const put = (k, f) => {
      if (!acc.has(k)) acc.set(k, {
        key: k, stockValue: 0, pieces: 0, barcodes: 0,
        salesValue: 0, cost: 0, margin: 0, qty: 0
      })
      f(acc.get(k))
    }

    // stock has no shop-vs-branch naming difference to reconcile at
    // the group and type levels, so it is only summed where the
    // dimension exists on both sides
    for (const r of stock) {
      if (!matches(r, path.length)) continue
      const k = keyOf[level] ? keyOf[level](r) : null
      if (k == null) continue
      put(k, a => {
        a.stockValue += Number(r.value || 0)
        a.pieces     += Number(r.pieces || 0)
        a.barcodes   += Number(r.barcodes || 0)
      })
    }

    for (const r of sales) {
      if (!matches(r, path.length)) continue
      const k = keyOf[level] ? keyOf[level](r) : null
      if (k == null) continue
      put(k, a => {
        a.salesValue += Number(r.value_extax || 0)
        a.cost       += Number(r.cost || 0)
        a.margin     += Number(r.margin || 0)
        a.qty        += Number(r.qty || 0)
      })
    }

    return [...acc.values()]
      .map(a => ({
        ...a,
        marginPct: a.salesValue ? (a.margin / a.salesValue) * 100 : null,
        // how long the stock would last at the rate it is selling
        coverDays: a.salesValue > 0 && a.stockValue > 0
          ? (a.stockValue / (a.salesValue / Math.max(days, 1))) : null
      }))
      .sort((x, y) => (y.salesValue - x.salesValue) || (y.stockValue - x.stockValue))
  }, [stock, sales, path, level, days])

  const total = useMemo(() => rows.reduce((s, r) => ({
    stockValue: s.stockValue + r.stockValue,
    salesValue: s.salesValue + r.salesValue,
    margin: s.margin + r.margin,
    pieces: s.pieces + r.pieces
  }), { stockValue: 0, salesValue: 0, margin: 0, pieces: 0 }), [rows])

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
      [LABEL[level]]: r.key,
      'Stock value': Math.round(r.stockValue),
      'Pieces': Math.round(r.pieces),
      'Sales (no tax)': Math.round(r.salesValue),
      'Margin': Math.round(r.margin),
      'Margin %': r.marginPct == null ? '' : Number(r.marginPct.toFixed(2)),
      'Stock cover (days)': r.coverDays == null ? '' : Math.round(r.coverDays)
    }))), LABEL[level].slice(0, 31))
    XLSX.writeFile(wb, `MIS ${path.join(' - ') || 'all'} ${from} to ${to}.xlsx`)
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load the dashboard</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_stock_by_group or v_sales_by_group, run
          supabase/54_cc_grouping.sql.
        </p>
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">MIS</h1>
          <p className="text-sm text-slate2">
            Stock is what is on hand now. Sales are {dt(from)} to {dt(to)} — {days} days.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="date" className="!w-auto" value={from}
            onChange={e => setFrom(e.target.value)} />
          <input type="date" className="!w-auto" value={to}
            onChange={e => setTo(e.target.value)} />
          <button className="btn-ghost btn-sm" onClick={exportExcel}>Excel</button>
        </div>
      </div>

      {/* where we are */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <button onClick={() => setPath([])}
          className={'rounded-md px-2.5 py-1 font-semibold ' +
            (path.length ? 'text-slate2 hover:bg-paper' : 'bg-ink text-white')}>
          All
        </button>
        {path.map((step, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="text-mute">›</span>
            <button onClick={() => setPath(path.slice(0, i + 1))}
              className={'rounded-md px-2.5 py-1 font-semibold ' +
                (i === path.length - 1 ? 'bg-ink text-white' : 'text-slate2 hover:bg-paper')}>
              {step}
            </button>
          </span>
        ))}
        {!atBottom && (
          <span className="ml-1 text-2xs text-slate2">
            showing by {LABEL[level].toLowerCase()} — tap a row to go deeper
          </span>
        )}
      </div>

      {loading ? <div className="card h-64 animate-pulse bg-line2" /> : (
        <>
          <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="Stock value" value={lakh(total.stockValue)} />
            <Cell label={`Sales, ${days} days`} value={lakh(total.salesValue)} feature />
            <Cell label="Margin" value={lakh(total.margin)}
              sub={total.salesValue ? num(total.margin / total.salesValue * 100, 1) + '%' : null} />
            <Cell label="Stock cover"
              value={total.salesValue > 0
                ? Math.round(total.stockValue / (total.salesValue / days)) + ' days'
                : '—'}
              tone={total.salesValue > 0 &&
                    total.stockValue / (total.salesValue / days) > 180 ? 'bad' : null} />
          </div>

          {rows.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate2">
              Nothing here for these dates.
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2.5 text-left">{LABEL[level]}</th>
                    <th className="px-3 py-2.5 text-right">Stock</th>
                    <th className="px-3 py-2.5 text-right">Sales</th>
                    <th className="px-3 py-2.5 text-right">Margin</th>
                    <th className="px-3 py-2.5 text-right">Margin %</th>
                    <th className="px-3 py-2.5 text-right">Share</th>
                    <th className="px-4 py-2.5 text-right">Cover</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const share = total.salesValue ? r.salesValue / total.salesValue * 100 : 0
                    const slow = r.coverDays != null && r.coverDays > 180
                    return (
                      <tr key={r.key}
                        className={'border-t border-line ' + (atBottom ? '' : 'cursor-pointer hover:bg-paper')}
                        onClick={() => !atBottom && setPath([...path, r.key])}>
                        <td className="px-4 py-3">
                          <span className="font-medium">{r.key}</span>
                          {!atBottom && <span className="ml-1.5 text-mute">›</span>}
                          {r.barcodes > 0 && (
                            <span className="block text-2xs text-slate2">
                              {Number(r.barcodes).toLocaleString('en-IN')} barcodes ·{' '}
                              {Math.round(r.pieces).toLocaleString('en-IN')} pieces
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">{lakh(r.stockValue)}</td>
                        <td className="px-3 py-3 text-right font-semibold">{lakh(r.salesValue)}</td>
                        <td className="px-3 py-3 text-right">{lakh(r.margin)}</td>
                        <td className="px-3 py-3 text-right">
                          {r.marginPct == null ? '—' : (
                            <span className={r.marginPct < 25 ? 'text-bad'
                              : r.marginPct > 40 ? 'text-good' : ''}>
                              {num(r.marginPct, 1)}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-slate2">
                          {share > 0 ? num(share, 1) + '%' : '—'}
                        </td>
                        <td className={'px-4 py-3 text-right ' + (slow ? 'font-semibold text-bad' : '')}>
                          {r.coverDays == null ? '—'
                            : r.coverDays > 999 ? '999+'
                            : Math.round(r.coverDays) + 'd'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-2xs text-slate2">
            Cover is how long the stock would last at the rate it sold over these
            {' '}{days} days. Over 180 is shown in red — that is money sitting still.
            A dash means nothing sold, which is worse than a large number, not better.
          </p>
        </>
      )}
    </div>
  )
}

function Cell({ label, value, sub, feature, tone }) {
  return (
    <div className={'px-4 py-3 ' + (feature ? 'bg-ink text-white' : '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className={'text-xl font-semibold ' + (tone === 'bad' ? 'text-bad' : '')}>{value}</div>
      {sub && <div className={'text-2xs ' + (feature ? 'text-white/60' : 'text-slate2')}>{sub}</div>}
    </div>
  )
}
