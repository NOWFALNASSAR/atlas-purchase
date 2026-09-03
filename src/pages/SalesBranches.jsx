import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, inr, lakh, num } from '../lib/db'
import { useEntity } from '../App'

const SORTS = [
  { key: 'achieved',       label: 'Sales' },
  { key: 'achievement_pct',label: 'Achievement' },
  { key: 'margin',         label: 'Margin' },
  { key: 'bills',          label: 'Bills' },
  { key: 'basket_value',   label: 'Basket' },
  { key: 'balance',        label: 'Gap to target' }
]

const STATUS = {
  achieved:  'bg-good/15 text-good',
  'on track':'bg-ink/10 text-ink',
  attention: 'bg-gold/15 text-gold',
  critical:  'bg-bad/10 text-bad',
  'no target':'bg-line text-slate2'
}

export default function SalesBranches() {
  const { entityId } = useEntity()
  const [rows, setRows] = useState([])
  const [compare, setCompare] = useState({})
  const [sort, setSort] = useState('achieved')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [entityId])

  async function load() {
    setLoading(true)
    const [p, c] = await Promise.all([
      db.from('v_target_progress').select('*'),
      db.from('v_sales_comparison').select('*')
    ])
    const keep = r => entityId === 'mixed' || !r.entity_id || r.entity_id === entityId
    setRows((p.data || []).filter(keep))
    const m = {}
    ;(c.data || []).forEach(r => { m[r.branch_id] = r })
    setCompare(m)
    setLoading(false)
  }

  const shown = [...rows].sort((a, b) =>
    sort === 'balance' ? Number(b.balance) - Number(a.balance)
                       : Number(b[sort] || 0) - Number(a[sort] || 0))

  const total = rows.reduce((s, r) => ({
    target: s.target + Number(r.target || 0),
    achieved: s.achieved + Number(r.achieved || 0),
    bills: s.bills + Number(r.bills || 0),
    margin: s.margin + Number(r.margin || 0)
  }), { target: 0, achieved: 0, bills: 0, margin: 0 })

  function exportExcel() {
    const sheet = XLSX.utils.json_to_sheet(shown.map(r => {
      const c = compare[r.branch_id] || {}
      return {
        Branch: r.branch_name,
        Target: r.target, Achieved: r.achieved,
        'Achievement %': r.achievement_pct, Balance: r.balance,
        'Required Daily': r.required_daily, Status: r.status,
        Bills: r.bills, 'Basket Value': r.basket_value,
        'Items per Bill': r.items_per_bill,
        Margin: r.margin, 'Margin %': r.margin_pct,
        'Last Month': c.last_month, 'Last Year': c.last_year
      }
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Branches')
    XLSX.writeFile(wb, 'branch-performance.xlsx')
  }

  return (
    <div className="page page-xl space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Branch performance</h1>
          <p className="text-sm text-slate2">Month to date, against target.</p>
        </div>
        <button className="btn-ghost shrink-0" onClick={exportExcel} disabled={!rows.length}>
          Export Excel
        </button>
      </div>

      <div className="card grid grid-cols-2 divide-x divide-line md:grid-cols-4">
        <Stat label="Target" value={lakh(total.target)} />
        <Stat label="Achieved" value={lakh(total.achieved)} strong />
        <Stat label="Achievement"
          value={total.target ? num(total.achieved / total.target * 100, 1) + '%' : '—'} />
        <Stat label="Margin"
          value={total.achieved ? num(total.margin / total.achieved * 100, 1) + '%' : '—'} />
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {SORTS.map(s => (
          <button key={s.key} onClick={() => setSort(s.key)}
            className={'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (sort === s.key ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? <div className="py-10 text-center text-sm text-slate2">Loading</div>
        : shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          No branches yet. Add them in Settings, or upload sales data.
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {shown.map(r => {
            const c = compare[r.branch_id] || {}
            const growth = c.last_month > 0
              ? ((c.this_month - c.last_month) / c.last_month * 100) : null
            return (
              <li key={r.branch_id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{r.branch_name}</div>
                    <div className="text-[11px] text-slate2">
                      {r.bills} bills · basket {inr(r.basket_value)} · {r.items_per_bill} items/bill
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-bold">{lakh(r.achieved)}</div>
                    {growth !== null && (
                      <div className={'text-[11px] font-semibold ' +
                        (growth >= 0 ? 'text-good' : 'text-bad')}>
                        {growth >= 0 ? '+' : ''}{num(growth)}% vs last month
                      </div>
                    )}
                  </div>
                  <span className={'tag ' + (STATUS[r.status] || 'bg-line text-slate2')}>
                    {r.achievement_pct != null ? r.achievement_pct + '%' : r.status}
                  </span>
                </div>

                {Number(r.target) > 0 && (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                      <div className={'h-1.5 rounded-full ' +
                        (r.achievement_pct >= 100 ? 'bg-good'
                          : r.achievement_pct >= 85 ? 'bg-ink' : 'bg-gold')}
                        style={{ width: Math.min(r.achievement_pct || 0, 100) + '%' }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[11px] text-slate2">
                      <span>target {lakh(r.target)}</span>
                      {Number(r.balance) > 0 && (
                        <span>
                          gap {lakh(r.balance)} · needs {inr(r.required_daily)}/day
                          for {r.days_left} days
                        </span>
                      )}
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, strong }) {
  return (
    <div className={'px-4 py-3 ' + (strong ? 'bg-ink/5' : '')}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  )
}
