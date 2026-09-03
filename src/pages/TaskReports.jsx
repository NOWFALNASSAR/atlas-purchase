import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { db, dt } from '../lib/db'

const PERIODS = [
  { key: 'day',     label: 'Today',        days: 0 },
  { key: 'week',    label: 'This week',    days: 7 },
  { key: 'month',   label: 'This month',   days: 30 },
  { key: 'quarter', label: 'This quarter', days: 90 }
]

export default function TaskReports() {
  const [period, setPeriod] = useState('month')
  const [rows, setRows] = useState([])
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [period])

  function range() {
    const to = new Date()
    const from = new Date()
    const p = PERIODS.find(x => x.key === period)
    if (period === 'day') from.setHours(0, 0, 0, 0)
    else if (period === 'week') from.setDate(to.getDate() - to.getDay())
    else if (period === 'month') from.setDate(1)
    else from.setMonth(Math.floor(to.getMonth() / 3) * 3, 1)
    return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]
  }

  async function load() {
    setLoading(true)
    const [from, to] = range()
    const [{ data: perf }, { data: esc }] = await Promise.all([
      db.rpc('dept_performance', { p_from: from, p_to: to }),
      db.from('v_task_escalations').select('*').order('created_at')
    ])
    setRows(perf || []); setEscalations(esc || []); setLoading(false)
  }

  const active = rows.filter(r => Number(r.received) > 0)

  const totals = active.reduce((s, r) => ({
    received: s.received + Number(r.received || 0),
    completed: s.completed + Number(r.completed || 0),
    open: s.open + Number(r.still_open || 0),
    overdue: s.overdue + Number(r.overdue || 0),
    reissued: s.reissued + Number(r.reissued || 0)
  }), { received: 0, completed: 0, open: 0, overdue: 0, reissued: 0 })

  function exportExcel() {
    const sheet = XLSX.utils.json_to_sheet(active.map(r => ({
      Department: r.department, Received: r.received, Accepted: r.accepted,
      Completed: r.completed, Verified: r.verified, Reissued: r.reissued,
      'Still Open': r.still_open, Overdue: r.overdue,
      'Accepted On Time': r.accepted_on_time, 'Finished On Time': r.finished_on_time,
      'Avg Hours to Accept': r.avg_hours_to_accept,
      'Avg Days to Close': r.avg_days_to_close,
      'On Time %': r.on_time_pct, 'First Time Right %': r.quality_pct
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Departments')
    XLSX.writeFile(wb, `department-performance-${period}.xlsx`)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Department performance</h1>
          <p className="text-sm text-slate2">
            How quickly each department accepts work, and how often it lands on time.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={exportExcel} disabled={!active.length}>
          Export Excel
        </button>
      </div>

      <div className="flex gap-1">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (period === p.key ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="card grid grid-cols-2 divide-x divide-line md:grid-cols-5">
        <Stat label="Raised" value={totals.received} />
        <Stat label="Completed" value={totals.completed} />
        <Stat label="Still open" value={totals.open} />
        <Stat label="Overdue" value={totals.overdue} bad={totals.overdue > 0} />
        <Stat label="Reissued" value={totals.reissued} warn={totals.reissued > 0} />
      </div>

      {escalations.length > 0 && (
        <section className="card overflow-hidden border-bad">
          <div className="bg-bad/10 px-4 py-2.5 text-sm font-bold text-bad">
            {escalations.length} task{escalations.length > 1 ? 's' : ''} to escalate
          </div>
          <ul className="divide-y divide-line">
            {escalations.slice(0, 10).map(e => (
              <li key={e.id} className="px-4 py-2.5 text-[13px]">
                <div className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{e.title}</span>
                    <span className="block text-[11px] text-slate2">
                      {e.task_no} · {e.to_dept_name} · raised {dt(e.created_at)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[11px] font-semibold text-bad">{e.reason}</span>
                    <span className="block text-[11px] text-slate2">
                      to {e.escalate_to_name}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? <div className="py-10 text-center text-sm text-slate2">Loading</div>
        : active.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          No tasks in this period.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-4 py-2 text-left">Department</th>
                  <th className="px-2 py-2 text-right">Got</th>
                  <th className="px-2 py-2 text-right">Done</th>
                  <th className="px-2 py-2 text-right">Open</th>
                  <th className="px-2 py-2 text-right">Accept</th>
                  <th className="px-2 py-2 text-right">On time</th>
                  <th className="px-4 py-2 text-right">1st time</th>
                </tr>
              </thead>
              <tbody>
                {active.map(r => (
                  <tr key={r.dept_code} className="border-t border-line">
                    <td className="px-4 py-2.5 font-medium">{r.department}</td>
                    <td className="px-2 py-2.5 text-right">{r.received}</td>
                    <td className="px-2 py-2.5 text-right">{r.completed}</td>
                    <td className={'px-2 py-2.5 text-right ' +
                      (Number(r.overdue) > 0 ? 'font-semibold text-bad' : '')}>
                      {r.still_open}
                      {Number(r.overdue) > 0 && ` (${r.overdue} late)`}
                    </td>
                    <td className="px-2 py-2.5 text-right text-slate2">
                      {r.avg_hours_to_accept != null ? r.avg_hours_to_accept + 'h' : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <Pct v={r.on_time_pct} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Pct v={r.quality_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-[11px] text-slate2">
            <b>On time</b> is finished by the date that department itself promised.
            <b> First time</b> is closed without being reissued. A department can
            look good on time and poor first time, which usually means the dates
            are being met by cutting the work short.
          </p>
        </div>
      )}
    </div>
  )
}

function Pct({ v }) {
  if (v == null) return <span className="text-slate2">—</span>
  return (
    <span className={'font-semibold ' +
      (v >= 90 ? 'text-good' : v >= 70 ? '' : 'text-bad')}>{v}%</span>
  )
}

function Stat({ label, value, warn, bad }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className={'text-xl font-bold ' + (bad ? 'text-bad' : warn ? 'text-gold' : '')}>
        {value}
      </div>
    </div>
  )
}
