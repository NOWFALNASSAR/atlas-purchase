import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, lakh, inr, num, dt } from '../lib/db'
import UploadStatus from '../components/UploadStatus'

/* ==================================================================
   MONTH BY MONTH

   Bought, sold, and what is left — per month, per shop.

   The three figures are measured, not derived from one another, and
   they will not reconcile arithmetically. Opening plus purchases minus
   sales equals closing only where nothing was transferred, returned,
   written off or miscounted, and across nine shops all four happen.
   Showing them side by side and letting the difference be visible is
   more honest than forcing them to agree.
   ================================================================== */

export default function MonthReport() {
  const [months, setMonths] = useState([])
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(null)      // which month is expanded
  const [month, setMonth] = useState('all')   // pickers, as on the other reports
  const [shop, setShop] = useState('all')
  const [stockNow, setStockNow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [a, b, c] = await Promise.all([
      db.from('v_month_all_shops').select('*').order('month', { ascending: false }),
      db.from('v_month_by_shop').select('*').order('month', { ascending: false }),
      // what is held right now, across every shop — the figure to set a
      // month's trading against
      db.from('v_stock_summary').select('*').maybeSingle()
    ])
    if (a.error || b.error) { setFailed((a.error || b.error).message); setLoading(false); return }
    setMonths(a.data || [])
    setRows(b.data || [])
    setStockNow(c.data || null)
    if ((a.data || []).length) setOpen(a.data[0].month)
    setLoading(false)
  }

  /* What the pickers select. A month with no shop chosen means every
     shop; a shop with no month means that shop's whole history. Both
     chosen gives one cell of the table, which is the question people
     usually arrive with: what did this shop buy and sell that month. */
  const shopNames = [...new Set(rows.map(r => r.shop))].sort()
  const picked = rows.filter(r =>
    (month === 'all' || r.month === month) && (shop === 'all' || r.shop === shop))

  const sum = k => picked.reduce((t, r) => t + Number(r[k] || 0), 0)
  const total = {
    purchase: sum('purchase_value'),
    sales:    sum('sales_value'),
    cost:     sum('sales_cost'),
    margin:   sum('margin'),
    // closing is a reading, so only the rows that actually have one
    closing:  picked.filter(r => r.closing_value != null)
                    .reduce((t, r) => t + Number(r.closing_value), 0),
    counted:  picked.filter(r => r.closing_value != null).length,
    shops:    picked.length
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(months.map(m => ({
      Month: m.month,
      'Purchased': Math.round(m.purchase_value),
      'Purchased pieces': Math.round(m.purchase_qty),
      'Sold (no tax)': Math.round(m.sales_value),
      'Sold pieces': Math.round(m.sales_qty),
      'Margin': Math.round(m.margin),
      'Margin %': m.margin_pct,
      'Closing stock': m.closing_value == null ? '' : Math.round(m.closing_value),
      'Shops counted': `${m.shops_counted} of ${m.shops}`
    }))), 'By month')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
      Month: r.month, Shop: r.shop,
      'Purchased': Math.round(r.purchase_value),
      'Batches': r.batches,
      'Sold (no tax)': Math.round(r.sales_value),
      'Margin': Math.round(r.margin),
      'Margin %': r.margin_pct,
      'Closing stock': r.closing_value == null ? '' : Math.round(r.closing_value),
      'Stock counted on': r.counted_on || ''
    }))), 'By shop')
    XLSX.writeFile(wb, `Month by month ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this names v_month_by_shop, run supabase/90_month_by_shop.sql.
        </p>
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-4">
      <UploadStatus />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Month by month</h1>
          <p className="text-sm text-slate2">
            Bought, sold and what is left. Tap a month for the shops.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="!w-auto" value={month} onChange={e => setMonth(e.target.value)}>
            <option value="all">Every month</option>
            {months.map(m => (
              <option key={m.month} value={m.month}>{monthName(m.month)}</option>
            ))}
          </select>
          <select className="!w-auto" value={shop} onChange={e => setShop(e.target.value)}>
            <option value="all">All shops</option>
            {shopNames.map(sh => <option key={sh} value={sh}>{sh}</option>)}
          </select>
          <button className="btn-ghost btn-sm" onClick={exportExcel}>Excel</button>
        </div>
      </div>

      {!loading && picked.length > 0 && (
        <>
          <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5">
            <Fig label="Purchased" value={lakh(total.purchase)}
              sub={month === 'all' ? 'every month' : monthName(month)} />
            <Fig label="Sold, without tax" value={lakh(total.sales)} feature />
            <Fig label="Cost of what sold" value={lakh(total.cost)} />
            <Fig label="Margin" value={lakh(total.margin)}
              sub={total.sales ? num(total.margin / total.sales * 100, 1) + '%' : null} />
            <Fig label="Closing stock" value={total.closing ? lakh(total.closing) : '—'}
              sub={total.counted < total.shops
                ? `${total.counted} of ${total.shops} counted` : 'at cost'} />
          </div>

          <div className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">
                Purchased against sold
                {shop !== 'all' && <span className="font-normal text-slate2"> · {shop}</span>}
                {month !== 'all' && <span className="font-normal text-slate2"> · {monthName(month)}</span>}
              </span>
              <span className="text-sm">
                {total.purchase > total.cost
                  ? <span className="text-gold">
                      {lakh(total.purchase - total.cost)} more bought than sold, at cost
                    </span>
                  : <span className="text-good">
                      {lakh(total.cost - total.purchase)} more sold than bought, at cost
                    </span>}
              </span>
            </div>
            <p className="mt-1.5 text-2xs text-slate2">
              Both at cost, so they are comparable — the sales figure here is what the
              goods cost you, not what they sold for. Buying more than you sell month
              after month is stock building up; the closing figure above is where it
              has built up to.
            </p>
            {stockNow && (
              <p className="mt-2 border-t border-line pt-2 text-xs text-slate2">
                Held right now across every shop:{' '}
                <span className="font-semibold text-ink">{lakh(stockNow.stock_value)}</span>
                {stockNow.value_over_180 > 0 && (
                  <> · {lakh(stockNow.value_over_180)} of it sitting more than six months</>
                )}
              </p>
            )}
          </div>
        </>
      )}

      {loading ? <div className="card h-64 animate-pulse bg-line2" />
        : months.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          Nothing yet. This fills as stock and sales are uploaded.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left">Month</th>
                <th className="px-3 py-2 text-right">Purchased</th>
                <th className="px-3 py-2 text-right">Sold</th>
                <th className="px-3 py-2 text-right">Margin</th>
                <th className="px-3 py-2 text-right">Margin %</th>
                <th className="px-4 py-2 text-right">Closing stock</th>
              </tr>
            </thead>
            <tbody>
              {months.filter(m => month === 'all' || m.month === month).map(m => {
                const expanded = open === m.month || month !== 'all'
                const shops = rows.filter(r => r.month === m.month &&
                                          (shop === 'all' || r.shop === shop))
                return (
                  <>
                    <tr key={m.month}
                      className="cursor-pointer border-t border-line hover:bg-paper"
                      onClick={() => setOpen(expanded ? null : m.month)}>
                      <td className="px-4 py-3 font-medium">
                        {monthName(m.month)}
                        <span className="ml-1.5 text-mute">{expanded ? '−' : '+'}</span>
                      </td>
                      <td className="px-3 py-3 text-right">{lakh(m.purchase_value)}</td>
                      <td className="px-3 py-3 text-right font-semibold">{lakh(m.sales_value)}</td>
                      <td className="px-3 py-3 text-right">{lakh(m.margin)}</td>
                      <td className="px-3 py-3 text-right">
                        {m.margin_pct == null ? '—' : num(m.margin_pct, 1) + '%'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {m.closing_value == null ? '—' : lakh(m.closing_value)}
                        {m.shops_counted < m.shops && (
                          <span className="block text-2xs text-gold">
                            {m.shops_counted} of {m.shops} shops counted
                          </span>
                        )}
                      </td>
                    </tr>

                    {expanded && shops.map(r => (
                      <tr key={m.month + r.shop} className="border-t border-line bg-paper/60">
                        <td className="py-2 pl-8 pr-3 text-xs">{r.shop}</td>
                        <td className="px-3 py-2 text-right text-xs">
                          {lakh(r.purchase_value)}
                          {r.batches > 0 && (
                            <span className="block text-2xs text-slate2">{r.batches} batches</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-semibold">
                          {lakh(r.sales_value)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs">{lakh(r.margin)}</td>
                        <td className="px-3 py-2 text-right text-xs">
                          {r.margin_pct == null ? '—' : num(r.margin_pct, 1) + '%'}
                        </td>
                        <td className="px-4 py-2 text-right text-xs">
                          {r.closing_value == null
                            ? <span className="text-gold">no stock file</span>
                            : <>
                                {lakh(r.closing_value)}
                                <span className="block text-2xs text-slate2">
                                  counted {dt(r.counted_on)}
                                </span>
                              </>}
                        </td>
                      </tr>
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-2xs text-slate2">
        Closing stock is a reading, not a calculation — it is whatever the last stock
        file of that month said the shop held. Purchases, sales and closing will not
        add up exactly: transfers, returns and write-offs all sit between them, and
        showing the difference is more use than hiding it.
      </p>
    </div>
  )
}

function Fig({ label, value, sub, feature }) {
  return (
    <div className={'px-4 py-3 ' + (feature ? 'bg-ink text-white' : '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className={'text-2xs ' + (feature ? 'text-white/60' : 'text-slate2')}>{sub}</div>}
    </div>
  )
}

function monthName(d) {
  const x = new Date(d)
  return x.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}
