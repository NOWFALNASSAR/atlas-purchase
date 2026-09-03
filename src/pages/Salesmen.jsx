import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, inr, lakh } from '../lib/db'

const METRICS = [
  { key: 'net_sales',    label: 'Sales' },
  { key: 'achievement_pct', label: 'Achievement' },
  { key: 'basket_value', label: 'Basket value' },
  { key: 'bills',        label: 'Bills' },
  { key: 'items_per_bill', label: 'Items per bill' },
  { key: 'margin_pct',   label: 'Margin %' }
]

export default function Salesmen() {
  const [rows, setRows] = useState([])
  const [branches, setBranches] = useState([])
  const [branch, setBranch] = useState('')
  const [metric, setMetric] = useState('net_sales')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [r, b] = await Promise.all([
      db.from('v_salesman_ranked').select('*'),
      db.from('branches').select('id,code,name').eq('active', true).order('code')
    ])
    setRows(r.data || []); setBranches(b.data || []); setLoading(false)
  }

  const shown = rows
    .filter(r => !branch || r.branch_id === branch)
    .filter(r => !q || (r.salesman_name + r.salesman_code).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0))

  const totals = shown.reduce((s, r) => ({
    sales: s.sales + Number(r.net_sales || 0),
    bills: s.bills + Number(r.bills || 0),
    qty: s.qty + Number(r.qty || 0)
  }), { sales: 0, bills: 0, qty: 0 })

  const avgBasket = totals.bills ? totals.sales / totals.bills : 0

  function exportExcel() {
    const sheet = XLSX.utils.json_to_sheet(shown.map((r, i) => ({
      Rank: i + 1, Salesman: r.salesman_name, Code: r.salesman_code,
      Branch: r.branch_name,
      Target: r.target, Sales: r.net_sales, 'Achievement %': r.achievement_pct,
      Bills: r.bills, Qty: r.qty,
      'Basket Value': r.basket_value, 'Items per Bill': r.items_per_bill,
      Margin: r.margin, 'Margin %': r.margin_pct, 'Days Worked': r.days_worked
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Salesmen')
    XLSX.writeFile(wb, 'salesman-performance.xlsx')
  }

  const top = shown.slice(0, 3)

  return (
    <div className="page page-xl space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Salesmen</h1>
          <p className="text-sm text-slate2">Month to date. Ranked by {METRICS.find(m => m.key === metric)?.label.toLowerCase()}.</p>
        </div>
        <button className="btn-ghost shrink-0" onClick={exportExcel} disabled={!shown.length}>
          Export Excel
        </button>
      </div>

      {shown.length > 0 && (
        <div className="card grid grid-cols-3 divide-x divide-line">
          <Stat label="Team sales" value={lakh(totals.sales)} />
          <Stat label="Bills" value={totals.bills.toLocaleString('en-IN')} />
          <Stat label="Average basket" value={inr(avgBasket)} />
        </div>
      )}

      {/* top three */}
      {top.length === 3 && metric === 'net_sales' && (
        <div className="grid grid-cols-3 gap-2">
          {top.map((r, i) => (
            <div key={r.salesman_code}
              className={'card p-3 text-center ' + (i === 0 ? 'border-gold bg-gold/5' : '')}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">
                {['First', 'Second', 'Third'][i]}
              </div>
              <div className="mt-1 truncate text-[13px] font-bold">{r.salesman_name}</div>
              <div className="text-sm font-semibold">{lakh(r.net_sales)}</div>
              <div className="text-[11px] text-slate2">{r.bills} bills</div>
            </div>
          ))}
        </div>
      )}

      <div className="card grid gap-2 p-3 md:grid-cols-3">
        <input className="md:col-span-1" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search name or code" />
        <select value={branch} onChange={e => setBranch(e.target.value)}>
          <option value="">All branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={metric} onChange={e => setMetric(e.target.value)}>
          {METRICS.map(m => <option key={m.key} value={m.key}>Rank by {m.label}</option>)}
        </select>
      </div>

      {loading ? <div className="py-10 text-center text-sm text-slate2">Loading</div>
        : shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          No salesman data yet. It appears once sales are uploaded or synced.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Salesman</th>
                  <th className="px-2 py-2 text-right">Sales</th>
                  <th className="px-2 py-2 text-right">Bills</th>
                  <th className="px-2 py-2 text-right">Basket</th>
                  <th className="px-3 py-2 text-right">Ach.</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.salesman_code + r.branch_id} className="border-t border-line">
                    <td className="px-3 py-2.5 font-mono text-[11px] text-slate2">{i + 1}</td>
                    <td className="px-2 py-2.5">
                      <span className="block font-medium">{r.salesman_name}</span>
                      <span className="block text-[11px] text-slate2">
                        {r.branch_name} · {r.days_worked}d
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold">{lakh(r.net_sales)}</td>
                    <td className="px-2 py-2.5 text-right text-slate2">{r.bills}</td>
                    <td className="px-2 py-2.5 text-right">{inr(r.basket_value)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.achievement_pct != null ? (
                        <span className={'font-semibold ' +
                          (r.achievement_pct >= 100 ? 'text-good'
                            : r.achievement_pct >= 85 ? '' : 'text-gold')}>
                          {r.achievement_pct}%
                        </span>
                      ) : <span className="text-slate2">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-[11px] text-slate2">
            Ranking by sales alone rewards whoever works the busiest counter. Basket
            value and items per bill say more about how well someone actually sells.
          </p>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  )
}
