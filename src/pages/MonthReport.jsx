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
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [a, b] = await Promise.all([
      db.from('v_month_all_shops').select('*').order('month', { ascending: false }),
      db.from('v_month_by_shop').select('*').order('month', { ascending: false })
    ])
    if (a.error || b.error) { setFailed((a.error || b.error).message); setLoading(false); return }
    setMonths(a.data || [])
    setRows(b.data || [])
    if ((a.data || []).length) setOpen(a.data[0].month)
    setLoading(false)
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
        <button className="btn-ghost btn-sm" onClick={exportExcel}>Excel</button>
      </div>

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
              {months.map(m => {
                const expanded = open === m.month
                const shops = rows.filter(r => r.month === m.month)
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

function monthName(d) {
  const x = new Date(d)
  return x.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}
