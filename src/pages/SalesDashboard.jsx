import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, inr, lakh, dt, num } from '../lib/db'
import { useEntity } from '../App'

/** Where sales stand today and this month, and which branches need attention. */
export default function SalesDashboard() {
  const { entityId } = useEntity()
  const [today, setToday] = useState([])
  const [progress, setProgress] = useState([])
  const [trend, setTrend] = useState([])
  const [compare, setCompare] = useState([])
  const [divisions, setDivisions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [entityId])

  async function load() {
    setLoading(true)
    const [t, p, tr, c, dv] = await Promise.all([
      db.from('v_sales_today').select('*'),
      db.from('v_target_progress').select('*'),
      db.from('v_sales_trend').select('*'),
      db.from('v_sales_comparison').select('*'),
      db.from('v_sales_by_division').select('*').order('net_sales', { ascending: false })
    ])
    const keep = r => entityId === 'mixed' || !r.entity_id || r.entity_id === entityId
    setToday((t.data || []).filter(keep))
    setProgress((p.data || []).filter(keep))
    setTrend(tr.data || [])
    setCompare(c.data || [])
    setDivisions(dv.data || [])
    setLoading(false)
  }

  const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0)

  const todaySales = sum(today, 'net_sales')
  const yesterday = sum(today, 'yesterday_sales')
  const todayBills = sum(today, 'bills')
  const mtd = sum(progress, 'achieved')
  const target = sum(progress, 'target')
  const achievement = target > 0 ? (mtd / target * 100) : null
  const balance = Math.max(target - mtd, 0)
  const daysLeft = progress[0]?.days_left ?? 0
  const requiredDaily = daysLeft > 0 ? balance / daysLeft : 0
  const margin = sum(progress, 'margin')

  const thisMonth = sum(compare, 'this_month')
  const lastMonth = sum(compare, 'last_month')
  const growth = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth * 100) : null

  const needsAttention = progress
    .filter(p => ['critical', 'attention'].includes(p.status))
    .sort((a, b) => (a.achievement_pct || 0) - (b.achievement_pct || 0))

  const noData = !loading && today.length === 0 && progress.length === 0

  return (
    <div className="page page-xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">Sales</h1>
        <p className="text-sm text-slate2">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {noData && (
        <div className="card p-8 text-center">
          <div className="text-sm font-semibold">No sales data yet</div>
          <p className="mt-1 text-[13px] text-slate2">
            This fills in once the branch agents start syncing. Until then you can
            still set targets so the comparison is ready.
          </p>
          <Link to="/sales/targets" className="btn-ghost mt-4 inline-flex">Set targets</Link>
        </div>
      )}

      {!noData && (
        <>
          {/* today */}
          <section className="card overflow-hidden">
            <div className="bg-ink px-4 py-3 text-white">
              <div className="text-[11px] uppercase tracking-wider text-white/60">Today</div>
              <div className="mt-0.5 flex items-end gap-3">
                <div className="text-3xl font-bold">{lakh(todaySales)}</div>
                {yesterday > 0 && (
                  <div className={'pb-1 text-[13px] font-semibold ' +
                    (todaySales >= yesterday ? 'text-good' : 'text-gold')}>
                    {todaySales >= yesterday ? '+' : ''}
                    {num(((todaySales - yesterday) / yesterday) * 100)}% vs yesterday
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-line">
              <Cell label="Bills" value={todayBills.toLocaleString('en-IN')} />
              <Cell label="Basket" value={todayBills ? inr(todaySales / todayBills) : '—'} />
              <Cell label="Yesterday" value={lakh(yesterday)} />
            </div>
          </section>

          {/* month to date */}
          <section className="card p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-bold">This month</h2>
              {growth !== null && (
                <span className={'text-[13px] font-semibold ' +
                  (growth >= 0 ? 'text-good' : 'text-bad')}>
                  {growth >= 0 ? '+' : ''}{num(growth, 1)}% vs last month
                </span>
              )}
            </div>

            <div className="mb-3 flex items-end gap-4">
              <div>
                <div className="text-3xl font-bold">{lakh(mtd)}</div>
                <div className="text-[11px] text-slate2">achieved</div>
              </div>
              {target > 0 && (
                <div className="pb-1">
                  <div className="text-lg font-semibold text-slate2">of {lakh(target)}</div>
                  <div className="text-[11px] text-slate2">target</div>
                </div>
              )}
            </div>

            {target > 0 && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div className={'h-2 rounded-full ' +
                    (achievement >= 100 ? 'bg-good' : achievement >= 85 ? 'bg-ink' : 'bg-gold')}
                    style={{ width: Math.min(achievement, 100) + '%' }} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <Mini label="Achievement" value={num(achievement, 1) + '%'} />
                  <Mini label="Balance" value={lakh(balance)} />
                  <Mini label={`Need daily (${daysLeft}d)`} value={inr(requiredDaily)} warn />
                </div>
              </>
            )}

            {target === 0 && (
              <p className="text-[13px] text-slate2">
                No target set for this month.{' '}
                <Link to="/sales/targets" className="text-gold underline">Set one</Link> and
                achievement appears here.
              </p>
            )}
          </section>

          {/* needs attention */}
          {needsAttention.length > 0 && (
            <section className="card overflow-hidden border-gold">
              <div className="bg-gold/10 px-4 py-2.5 text-sm font-bold text-gold">
                {needsAttention.length} branch{needsAttention.length > 1 ? 'es' : ''} behind target
              </div>
              <ul className="divide-y divide-line">
                {needsAttention.slice(0, 6).map(b => (
                  <li key={b.branch_id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{b.branch_name}</span>
                      <span className="block text-[11px] text-slate2">
                        {lakh(b.achieved)} of {lakh(b.target)} · needs {inr(b.required_daily)}/day
                      </span>
                    </span>
                    <span className={'tag ' +
                      (b.status === 'critical' ? 'bg-bad/10 text-bad' : 'bg-gold/15 text-gold')}>
                      {b.achievement_pct}%
                    </span>
                  </li>
                ))}
              </ul>
              <Link to="/sales/branches"
                className="block border-t border-line px-4 py-2 text-center text-xs font-semibold text-gold underline">
                See all branches
              </Link>
            </section>
          )}

          {/* trend */}
          {trend.length > 1 && (
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-bold">Daily sales, last 30 days</h2>
              <Sparkline rows={trend.slice(-30)} />
            </section>
          )}

          {/* what is selling */}
          {divisions.length > 0 && (
            <section className="card overflow-hidden">
              <div className="px-4 py-3 text-sm font-bold">What sold, last 30 days</div>
              <table className="w-full text-[13px]">
                <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                  <tr>
                    <th className="px-4 py-2 text-left">Division</th>
                    <th className="px-3 py-2 text-right">Pcs</th>
                    <th className="px-3 py-2 text-right">Sales</th>
                    <th className="px-4 py-2 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {divisions.slice(0, 10).map(d => (
                    <tr key={d.division} className="border-t border-line">
                      <td className="px-4 py-2">{d.division}</td>
                      <td className="px-3 py-2 text-right text-slate2">{Math.round(d.qty)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{lakh(d.net_sales)}</td>
                      <td className="px-4 py-2 text-right">{d.margin_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Cell({ label, value }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  )
}

function Mini({ label, value, warn }) {
  return (
    <div className="rounded-md bg-paper px-2 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate2">{label}</div>
      <div className={'text-sm font-bold ' + (warn ? 'text-gold' : '')}>{value}</div>
    </div>
  )
}

/** Small bar chart, drawn with divs — no chart library needed. */
function Sparkline({ rows }) {
  const max = Math.max(...rows.map(r => Number(r.net_sales)), 1)
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]">
        {rows.map(r => (
          <div key={r.sale_date} className="group relative flex-1"
               title={`${dt(r.sale_date)} · ${inr(r.net_sales)}`}>
            <div className="w-full rounded-t bg-ink/80 transition-all group-hover:bg-gold"
                 style={{ height: Math.max((Number(r.net_sales) / max) * 96, 2) + 'px' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate2">
        <span>{dt(rows[0]?.sale_date)}</span>
        <span>{dt(rows[rows.length - 1]?.sale_date)}</span>
      </div>
    </div>
  )
}
