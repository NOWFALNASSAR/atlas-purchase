import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { db, inr, lakh, dt, num } from '../lib/db'

/* ==================================================================
   ORDERED AGAINST RECEIVED

   Receiving counts two ways and both appear here:

     confirmed  someone ticked it on the Goods received screen
     seen in stock  it turned up in the stock export and matched

   The second matters more than it sounds. Goods often arrive and
   nobody confirms them. A report counting only confirmations would
   show half the orders outstanding forever, and then nobody reads it.
   ================================================================== */

const TABS = [
  ['problems', 'Worth a look'],
  ['orders',   'By order'],
  ['lines',    'Every line']
]

export default function PoVariance() {
  const [tab, setTab] = useState('problems')
  const [d, setD] = useState({ problems: [], orders: [], lines: [] })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, o, l] = await Promise.all([
      db.from('v_po_problems').select('*').order('ordered_on', { ascending: false }).limit(300),
      db.from('v_po_variance').select('*').order('ordered_on', { ascending: false }).limit(300),
      db.from('v_po_variance_line').select('*').order('ordered_on', { ascending: false }).limit(600)
    ])
    if (p.error) { setFailed(p.error.message); setLoading(false); return }
    setD({ problems: p.data || [], orders: o.data || [], lines: l.data || [] })
    setLoading(false)
  }

  const totals = useMemo(() => {
    const o = d.orders
    return {
      orders: o.length,
      ordered: o.reduce((t, r) => t + Number(r.value_ordered || 0), 0),
      diff: o.reduce((t, r) => t + Number(r.value_diff || 0), 0),
      waiting: o.filter(r => r.state === 'nothing received').length,
      part: o.filter(r => r.state === 'part received').length,
      done: o.filter(r => r.state === 'all received').length
    }
  }, [d.orders])

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    const add = (name, rows) => rows.length &&
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31))
    add('Worth a look', d.problems); add('By order', d.orders); add('Every line', d.lines)
    XLSX.writeFile(wb, `Ordered against received ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this names v_po_variance or v_po_problems, run
          supabase/76_po_variance.sql.
        </p>
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">
            Ordered against received
          </h1>
          <p className="text-sm text-slate2">
            What you asked for, what turned up, and the difference.
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={exportExcel}>Excel</button>
      </div>

      <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-5 sm:divide-y-0">
        <Fig label="Orders" value={totals.orders} />
        <Fig label="Ordered value" value={lakh(totals.ordered)} />
        <Fig label="Difference" value={lakh(Math.abs(totals.diff))}
          sub={totals.diff < 0 ? 'less than ordered' : totals.diff > 0 ? 'more than ordered' : null}
          tone={totals.diff < 0 ? 'bad' : null} />
        <Fig label="Nothing yet" value={totals.waiting} tone={totals.waiting > 0 ? 'warn' : null} />
        <Fig label="Fully received" value={totals.done} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'rounded-md px-3 py-1.5 text-xs font-semibold ' +
              (tab === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {label}
            {k === 'problems' && d.problems.length > 0 && ` (${d.problems.length})`}
          </button>
        ))}
      </div>

      {loading ? <div className="card h-64 animate-pulse bg-line2" /> : (
        <>
          {tab === 'problems' && (
            d.problems.length === 0 ? (
              <div className="card p-8 text-center">
                <div className="text-base font-semibold">Nothing out of the ordinary</div>
                <p className="mt-1 text-sm text-slate2">
                  No short deliveries, no rate changes over 5%, nothing outstanding
                  more than 30 days.
                </p>
              </div>
            ) : (
              <ul className="card divide-y divide-line">
                {d.problems.map((r, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{r.item_name}</div>
                        <div className="text-2xs text-slate2">
                          <Link to={'/orders/' + r.po_id} className="font-medium text-ink">
                            {r.po_no}
                          </Link>
                          {' · '}{r.supplier}{' · ordered '}{dt(r.ordered_on)}
                        </div>
                      </div>
                      <span className={'tag shrink-0 ' + toneOf(r.problem)}>{r.problem}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-paper p-2.5 text-sm sm:grid-cols-4">
                      <Pair label="Ordered" value={num(r.qty_ordered, 0)} sub={inr(r.rate_ordered)} />
                      <Pair label="Received" value={num(r.qty_received, 0)}
                        sub={r.rate_received ? inr(r.rate_received) : '—'} />
                      <Pair label="Quantity"
                        value={r.qty_diff === 0 ? '—'
                          : (r.qty_diff > 0 ? '+' : '') + num(r.qty_diff, 0)}
                        tone={r.qty_diff < 0 ? 'bad' : r.qty_diff > 0 ? 'warn' : null} />
                      <Pair label="Rate"
                        value={r.rate_diff_pct == null ? '—'
                          : (r.rate_diff_pct > 0 ? '+' : '') + num(r.rate_diff_pct, 1) + '%'}
                        tone={r.rate_diff_pct > 0 ? 'bad' : r.rate_diff_pct < 0 ? 'good' : null} />
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === 'orders' && (
            <Table
              head={['Order', 'Supplier', 'Ordered', 'Value', 'Received', 'Difference', 'State']}
              align="llrrrrl"
              rows={d.orders.map(r => [
                r.po_no, r.supplier || '—', dt(r.ordered_on),
                lakh(r.value_ordered),
                num(r.qty_received, 0) + ' of ' + num(r.qty_ordered, 0),
                r.value_diff ? lakh(r.value_diff) : '—',
                r.state
              ])} />
          )}

          {tab === 'lines' && (
            <Table
              head={['Item', 'Order', 'Qty ordered', 'Qty received', 'Rate ordered',
                     'Rate received', 'Rate change', 'How', 'Days']}
              align="llrrrrrll"
              rows={d.lines.map(r => [
                r.item_name, r.po_no,
                num(r.qty_ordered, 0), num(r.qty_received, 0),
                inr(r.rate_ordered), r.rate_received ? inr(r.rate_received) : '—',
                r.rate_diff_pct == null ? '—' : num(r.rate_diff_pct, 1) + '%',
                r.how, r.days_to_arrive == null ? '—' : r.days_to_arrive
              ])} />
          )}
        </>
      )}

      <p className="text-2xs text-slate2">
        "Seen in stock" means the goods turned up in a stock upload from the same
        supplier, for the same item, after the order was raised — nobody confirmed
        them on the Goods received screen. They count as received here because
        otherwise the report would show them outstanding forever.
      </p>
    </div>
  )
}

const toneOf = p =>
  p === 'short delivery' || p === 'nothing after 30 days' ? 'bg-bad/10 text-bad'
  : p === 'rate went up' ? 'bg-bad/10 text-bad'
  : p === 'rate came down' ? 'bg-good/15 text-good'
  : 'bg-gold2 text-gold'

function Table({ head, rows, align = '' }) {
  if (!rows.length) return (
    <div className="card p-8 text-center text-sm text-slate2">Nothing here.</div>
  )
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={'whitespace-nowrap px-3 py-2 ' +
                (align[i] === 'r' ? 'text-right' : 'text-left')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => (
                <td key={j} className={'whitespace-nowrap px-3 py-2.5 ' +
                  (align[j] === 'r' ? 'text-right' : '')}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Fig({ label, value, sub, tone }) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={'text-lg font-semibold ' +
        (tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : '')}>{value}</div>
      {sub && <div className="text-2xs text-slate2">{sub}</div>}
    </div>
  )
}

function Pair({ label, value, sub, tone }) {
  return (
    <div>
      <div className="text-2xs text-slate2">{label}</div>
      <div className={'font-semibold ' +
        (tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn'
         : tone === 'good' ? 'text-good' : '')}>{value}</div>
      {sub && <div className="text-2xs text-slate2">{sub}</div>}
    </div>
  )
}
