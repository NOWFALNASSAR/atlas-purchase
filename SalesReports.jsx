import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, lakh, inr, dt, num } from '../lib/db'

/* ==================================================================
   SALES REPORTS

   Reads what the daily upload loads: sales_bills, sales_barcode_daily
   and sales_person_daily.

   Everything is on the value WITHOUT tax, because that is the figure
   the three exports agree on and the one targets and incentives run
   against. Where the with-tax number matters — the day total, the
   basket — both are shown.
   ================================================================== */

const TABS = [
  ['day',       'The day'],
  ['salesman',  'Salesmen'],
  ['item',      'Items'],
  ['division',  'Divisions'],
  ['supplier',  'Suppliers'],
  ['tax',       'Tax'],
  ['customers', 'Customers'],
  ['returns',   'Returns'],
  ['trend',     'Trend']
]

export default function SalesReports() {
  const [tab, setTab] = useState('day')
  const [date, setDate] = useState('')
  const [branch, setBranch] = useState('all')
  const [d, setD] = useState({})
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => { boot() }, [])
  useEffect(() => { if (date) load() }, [date, branch])

  async function boot() {
    // start on the most recent day that has been uploaded
    const { data, error } = await db.from('sales_uploads')
      .select('*').order('sale_date', { ascending: false }).limit(60)
    if (error) { setFailed(error.message); setLoading(false); return }
    const ups = data || []
    setD(x => ({ ...x, uploads: ups }))
    if (!ups.length) { setLoading(false); return }
    setDate(ups[0].sale_date)
  }

  async function load() {
    setLoading(true)
    const br = branch === 'all' ? null : branch
    const only = qb => (br ? qb.eq('branch_code', br) : qb)

    try {
      const [day, people, items, divi, sup, tax, cust, ret, trend] = await Promise.all([
        only(db.from('v_sales_day_full').select('*').eq('sale_date', date)),
        only(db.from('v_salesman_performance').select('*').eq('sale_date', date))
          .order('value_extax', { ascending: false }),
        only(db.from('sales_barcode_daily').select('*').eq('sale_date', date))
          .order('value_extax', { ascending: false }).limit(1000),
        db.from('v_sales_division').select('*').order('value_extax', { ascending: false }),
        db.from('v_sales_supplier').select('*').order('value_extax', { ascending: false }).limit(100),
        only(db.from('v_sales_tax').select('*').eq('sale_date', date)),
        db.from('v_customers').select('*').order('spent', { ascending: false }).limit(300),
        only(db.from('v_sales_returns').select('*').eq('sale_date', date)),
        db.from('v_sales_day_full').select('*').order('sale_date', { ascending: false }).limit(60)
      ])
      setD(x => ({
        ...x,
        day: day.data || [], people: people.data || [], items: items.data || [],
        divi: divi.data || [], sup: sup.data || [], tax: tax.data || [],
        cust: cust.data || [], ret: ret.data || [], trend: trend.data || []
      }))
      setFailed(null)
    } catch (e) { setFailed(e.message) }
    setLoading(false)
  }

  const branches = useMemo(() =>
    [...new Set((d.uploads || []).map(u => u.branch_code))].sort(), [d.uploads])

  const t = useMemo(() => (d.day || []).reduce((s, r) => ({
    bills:   s.bills   + Number(r.bills || 0),
    amount:  s.amount  + Number(r.amount_inc_tax || 0),
    extax:   s.extax   + Number(r.sales_extax || 0),
    tax:     s.tax     + Number(r.tax || 0),
    cost:    s.cost    + Number(r.cost || 0),
    margin:  s.margin  + Number(r.margin || 0),
    disc:    s.disc    + Number(r.discount || 0),
    pieces:  s.pieces  + Number(r.pieces || 0)
  }), { bills:0, amount:0, extax:0, tax:0, cost:0, margin:0, disc:0, pieces:0 }), [d.day])

  const basket = t.bills ? t.amount / t.bills : 0
  const marginPct = t.extax ? (t.margin / t.extax) * 100 : 0

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    const add = (n, rows) => rows?.length &&
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n.slice(0, 31))
    add('Day', d.day); add('Salesmen', d.people); add('Items', d.items)
    add('Divisions', d.divi); add('Suppliers', d.sup); add('Tax', d.tax)
    add('Customers', d.cust); add('Returns', d.ret); add('Trend', d.trend)
    XLSX.writeFile(wb, `Sales ${date}${branch === 'all' ? '' : ' ' + branch}.xlsx`)
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load sales</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_sales_day_full or sales_uploads, run
          supabase/42_sales.sql, then a day's import.
        </p>
      </div>
    </div>
  )

  if (!loading && !(d.uploads || []).length) return (
    <div className="page page-md py-16 text-center">
      <div className="mb-2 text-base font-semibold">No sales uploaded yet</div>
      <p className="text-sm text-slate2">
        Run <code className="rounded bg-paper px-1">42_sales.sql</code>, then generate
        a day with <code className="rounded bg-paper px-1">import-sales.mjs</code> and
        run it. This screen fills itself from there.
      </p>
    </div>
  )

  return (
    <div className="page page-xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Sales</h1>
          <p className="text-sm text-slate2">
            {date ? dt(date) : ''}{branch !== 'all' && ' · ' + branch}
            {' · everything without tax unless it says otherwise'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="!w-auto" value={date} onChange={e => setDate(e.target.value)}>
            {[...new Set((d.uploads || []).map(u => u.sale_date))].map(x =>
              <option key={x} value={x}>{dt(x)}</option>)}
          </select>
          {branches.length > 1 && (
            <select className="!w-auto" value={branch} onChange={e => setBranch(e.target.value)}>
              <option value="all">All branches</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <button className="btn-ghost btn-sm" onClick={exportExcel}>Excel</button>
        </div>
      </div>

      {loading ? <div className="card h-64 animate-pulse bg-line2" /> : (
        <>
          <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
            <Cell label="Sales without tax" value={lakh(t.extax)} feature />
            <Cell label="With tax" value={lakh(t.amount)} />
            <Cell label="Bills" value={t.bills.toLocaleString('en-IN')} />
            <Cell label="Basket value" value={inr(basket)} />
            <Cell label="Margin" value={lakh(t.margin)}
              sub={num(marginPct, 1) + '%'} />
            <Cell label="Discount" value={inr(t.disc)} />
          </div>

          <div className="-mx-4 overflow-x-auto px-4">
            <div className="flex w-max gap-1 rounded-md bg-paper p-1">
              {TABS.map(([k, l]) => (
                <button key={k} onClick={() => { setTab(k); setQ('') }}
                  className={'whitespace-nowrap rounded px-3 py-1.5 text-sm font-semibold ' +
                    (tab === k ? 'bg-white text-ink shadow-card' : 'text-slate2')}>{l}</button>
              ))}
            </div>
          </div>

          {tab === 'day' && (
            <Table head={['Branch', 'Bills', 'Without tax', 'With tax', 'Tax', 'Basket', 'Margin', 'Margin %']}
              align="lrrrrrrr"
              rows={(d.day || []).map(r => [
                r.branch_code, r.bills, inr(r.sales_extax), inr(r.amount_inc_tax),
                inr(r.tax), inr(r.basket_value), inr(r.margin),
                r.margin_pct == null ? '—' : num(r.margin_pct, 1) + '%'
              ])} />
          )}

          {tab === 'salesman' && (
            <>
              <p className="text-xs text-slate2">
                On the value without tax. A bill served by two people counts for both,
                so the bill numbers here add to more than the day's bill count.
              </p>
              <Table head={['Salesman', 'Pieces', 'Sales', 'Bills', 'Per bill', 'Target', 'Achieved', 'Incentive']}
                align="lrrrrrrr"
                rows={(d.people || []).map(r => [
                  (r.person_name || r.person_code),
                  num(r.qty, 0), inr(r.value_extax), r.bills, inr(r.value_per_bill),
                  r.target_extax ? inr(r.target_extax) : '—',
                  r.achievement_pct == null ? '—' : num(r.achievement_pct, 0) + '%',
                  r.incentive ? inr(r.incentive) : '—'
                ])} />
            </>
          )}

          {tab === 'item' && (
            <Searchable q={q} setQ={setQ} placeholder="Search barcode or item"
              rows={d.items || []}
              match={(r, x) => String(r.barcode).toLowerCase().includes(x) ||
                               (r.item_name || '').toLowerCase().includes(x)}
              head={['Barcode', 'Item', 'Qty', 'Sales', 'Cost', 'Margin', 'Margin %']}
              align="llrrrrr"
              cells={r => [
                r.barcode, r.item_name || '—', num(r.qty, 0),
                inr(r.value_extax), inr(r.cost), inr(r.margin),
                r.margin_pct == null ? '—' : num(r.margin_pct, 1) + '%'
              ]} />
          )}

          {(tab === 'division' || tab === 'supplier') && (
            <>
              <p className="text-xs text-slate2">
                Only barcodes we can identify appear here. The stock export lists
                barcodes that still have stock, so a batch sold out is unclassified
                until your billing vendor adds the division and supplier codes to the
                itemwise export.
              </p>
              <Table
                head={[tab === 'division' ? 'Division' : 'Supplier', 'Qty', 'Sales', 'Cost', 'Margin', 'Margin %']}
                align="lrrrrr"
                rows={(tab === 'division' ? d.divi : d.sup || []).map(r => [
                  tab === 'division' ? r.division : r.supplier,
                  num(r.qty, 0), inr(r.value_extax), inr(r.cost), inr(r.margin),
                  r.margin_pct == null ? '—' : num(r.margin_pct, 1) + '%'
                ])} />
            </>
          )}

          {tab === 'tax' && (
            <Table head={['Branch', 'Taxable 5%', 'Tax 5%', 'Taxable 12%', 'Tax 12%',
                          'Taxable 18%', 'Tax 18%', 'Exempted', 'Total tax']}
              align="lrrrrrrrr"
              rows={(d.tax || []).map(r => [
                r.branch_code, inr(r.taxable_5), inr(r.tax_5), inr(r.taxable_12),
                inr(r.tax_12), inr(r.taxable_18), inr(r.tax_18),
                inr(r.exempted), inr(r.tax_total)
              ])} />
          )}

          {tab === 'customers' && (
            <Searchable q={q} setQ={setQ} placeholder="Search name or number"
              rows={d.cust || []}
              match={(r, x) => (r.name || '').toLowerCase().includes(x) ||
                               String(r.customer_phone).includes(x)}
              note="Only bills where the counter captured a number. Walk-ins billed as General are not customers and are left out."
              head={['Customer', 'Phone', 'Visits', 'Spent', 'Average', 'Last seen', 'Days ago']}
              align="llrrrlr"
              cells={r => [
                r.name || '—', r.customer_phone, r.visits, inr(r.spent),
                inr(r.avg_bill), dt(r.last_seen), r.days_since
              ]} />
          )}

          {tab === 'returns' && (
            <Table head={['Barcode', 'Item', 'Qty', 'Value', 'Cost', 'Margin']}
              align="llrrrr"
              rows={(d.ret || []).map(r => [
                r.barcode, r.item_name || '—', num(r.qty, 0),
                inr(r.value_extax), inr(r.cost), inr(r.margin)
              ])} />
          )}

          {tab === 'trend' && (
            <Table head={['Date', 'Branch', 'Bills', 'Without tax', 'Basket', 'Margin %']}
              align="llrrrr"
              rows={(d.trend || []).map(r => [
                dt(r.sale_date), r.branch_code, r.bills, inr(r.sales_extax),
                inr(r.basket_value),
                r.margin_pct == null ? '—' : num(r.margin_pct, 1) + '%'
              ])} />
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Table({ head, rows, align = '' }) {
  if (!rows.length) return (
    <div className="card p-8 text-center text-sm text-slate2">Nothing for this day.</div>
  )
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr>{head.map((h, i) => (
          <th key={i} className={'px-3 py-2.5 ' + (align[i] === 'r' ? 'text-right' : 'text-left')}>{h}</th>
        ))}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-t border-line">
            {r.map((c, j) => (
              <td key={j} className={'px-3 py-2.5 ' + (align[j] === 'r' ? 'text-right' : '')}>{c}</td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function Searchable({ q, setQ, placeholder, rows, match, head, cells, align, note }) {
  const shown = q.trim() ? rows.filter(r => match(r, q.trim().toLowerCase())) : rows
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
          First 300 shown. Narrow the search, or use the Excel export.
        </p>
      )}
    </div>
  )
}

function Cell({ label, value, sub, feature }) {
  return (
    <div className={'px-4 py-3 ' + (feature ? 'bg-ink text-white' : '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className={'text-2xs ' + (feature ? 'text-white/60' : 'text-slate2')}>{sub}</div>}
    </div>
  )
}
