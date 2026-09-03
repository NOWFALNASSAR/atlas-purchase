import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db, dt, num } from '../lib/db'

/* ==================================================================
   TASK REPORTS

   Three views of the same work:

     Performance  how each department and showroom is doing
     Register     every task, raised to closed, with the detail
     End of day   what moved each day

   Everything exports to Excel, and the two that matter export to PDF.
   ================================================================== */

const PERIODS = [
  { key: 'day',     label: 'Today' },
  { key: 'week',    label: 'This week' },
  { key: 'month',   label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year',    label: 'This year' }
]

const STATUS_LABEL = {
  raised: 'New', reissued: 'Reissued', acknowledged: 'Accepted',
  in_progress: 'In progress', completed: 'Awaiting check',
  verified: 'Closed', cancelled: 'Cancelled', disputed: 'With MD Office'
}

export default function TaskReports() {
  const [tab, setTab] = useState('performance')
  const [period, setPeriod] = useState('month')

  const [perf, setPerf] = useState([])
  const [register, setRegister] = useState([])
  const [eod, setEod] = useState([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  const [who, setWho] = useState('all')       // all | department | showroom
  const [status, setStatus] = useState('all')

  useEffect(() => { load() }, [period])

  function range() {
    const to = new Date()
    const from = new Date()
    if (period === 'day') from.setHours(0, 0, 0, 0)
    else if (period === 'week') from.setDate(to.getDate() - to.getDay())
    else if (period === 'month') from.setDate(1)
    else if (period === 'quarter') from.setMonth(Math.floor(to.getMonth() / 3) * 3, 1)
    else from.setMonth(0, 1)
    return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]
  }

  async function load() {
    setLoading(true)
    const [from, to] = range()
    try {
      const [p, r, e] = await Promise.all([
        db.rpc('dept_performance', { p_from: from, p_to: to }),
        db.from('v_task_register').select('*')
          .gte('raised_on', from).lte('raised_on', to)
          .order('raised_on', { ascending: false }).limit(1000),
        db.from('v_task_eod').select('*').order('day', { ascending: false }).limit(30)
      ])
      if (p.error) throw p.error
      setPerf(p.data || [])
      setRegister(r.data || [])
      setEod(e.data || [])
      setFailed(null)
    } catch (err) {
      setFailed(err?.message || 'Could not load the reports')
    }
    setLoading(false)
  }

  /* ---------- shaped data ---------- */

  const active = useMemo(() => perf.filter(r => Number(r.received) > 0), [perf])
  const depts  = useMemo(() => active.filter(r => r.kind !== 'showroom'), [active])
  const shops  = useMemo(() => active.filter(r => r.kind === 'showroom'), [active])

  const shown = useMemo(() => (
    who === 'department' ? depts : who === 'showroom' ? shops : active
  ), [who, active, depts, shops])

  const totals = useMemo(() => active.reduce((s, r) => ({
    received:  s.received  + Number(r.received || 0),
    verified:  s.verified  + Number(r.verified || 0),
    open:      s.open      + Number(r.still_open || 0),
    overdue:   s.overdue   + Number(r.overdue || 0),
    reissued:  s.reissued  + Number(r.reissued || 0),
    disputed:  s.disputed  + Number(r.disputed || 0)
  }), { received: 0, verified: 0, open: 0, overdue: 0, reissued: 0, disputed: 0 }), [active])

  const regShown = useMemo(() => register.filter(r => {
    if (status !== 'all' && r.status !== status) return false
    if (who === 'department' && r.responsible_kind === 'showroom') return false
    if (who === 'showroom' && r.responsible_kind !== 'showroom') return false
    return true
  }), [register, status, who])

  /* ---------- exports ---------- */

  const periodLabel = PERIODS.find(p => p.key === period)?.label || period

  function exportExcel() {
    const wb = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(active.map(r => ({
      Name: r.department, Code: r.dept_code,
      Type: r.kind === 'showroom' ? 'Showroom' : 'Department',
      Received: r.received, Accepted: r.accepted, Completed: r.completed,
      Closed: r.verified, Reissued: r.reissued, Disputed: r.disputed,
      'Still Open': r.still_open, Overdue: r.overdue,
      'Accepted in 24h': r.accepted_on_time, 'Finished On Time': r.finished_on_time,
      'Avg Hours to Accept': r.avg_hours_to_accept,
      'Avg Days to Close': r.avg_days_to_close,
      'On Time %': r.on_time_pct, 'First Time Right %': r.quality_pct,
      'Closed %': r.closed_pct
    }))), 'Performance')

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regShown.map(r => ({
      'Task No': r.task_no, Title: r.title,
      'Raised By Dept': r.raised_by_dept, Responsible: r.responsible_dept,
      'Raised By': r.raised_by, 'Assigned To': r.assigned_to,
      Priority: r.priority, Status: STATUS_LABEL[r.status] || r.status,
      Raised: r.raised_on, Accepted: r.accepted_on, Due: r.due_date,
      'Planned Finish': r.planned_finish, 'Actual Finish': r.actual_finish,
      Closed: r.closed_on,
      'Hours to Accept': r.hours_to_accept, 'Days to Close': r.days_to_close,
      'Days Open': r.days_open,
      Overdue: r.overdue ? 'Yes' : '', 'Finished Late': r.finished_late ? 'Yes' : '',
      Reissued: r.reissue_count, Disputed: r.dispute_count,
      'Disputed From': r.disputed_from, Recurring: r.schedule_name,
      'Sub-points': r.points ? `${r.points_done}/${r.points}` : '',
      Notes: r.notes
    }))), 'Register')

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eod.map(r => ({
      Day: r.day, Raised: r.raised, Accepted: r.accepted,
      Completed: r.completed, Closed: r.closed, 'Overdue at Day End': r.overdue_at_eod
    }))), 'End of day')

    XLSX.writeFile(wb, `Atlas tasks ${periodLabel} ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function head(doc, title) {
    doc.setFont('helvetica', 'bold').setFontSize(14)
    doc.text('Atlas Maharani Group', 40, 40)
    doc.setFont('helvetica', 'normal').setFontSize(10)
    doc.text(title, 40, 58)
    doc.setFontSize(8).setTextColor(120)
    doc.text(`${periodLabel} · generated ${new Date().toLocaleString('en-IN')}`, 40, 72)
    doc.setTextColor(0)
  }

  function exportPerformancePdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
    head(doc, 'Department and showroom performance')

    autoTable(doc, {
      startY: 90,
      head: [['Name', 'Type', 'Received', 'Closed', 'Open', 'Overdue',
              'Reissued', 'Disputed', 'Avg hrs to accept', 'Avg days to close', 'On time %']],
      body: active.map(r => [
        r.department, r.kind === 'showroom' ? 'Showroom' : 'Department',
        r.received, r.verified, r.still_open, r.overdue,
        r.reissued, r.disputed,
        r.avg_hours_to_accept ?? '—', r.avg_days_to_close ?? '—',
        r.on_time_pct != null ? num(r.on_time_pct, 1) + '%' : '—'
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [14, 27, 46], fontSize: 8 },
      alternateRowStyles: { fillColor: [246, 248, 250] }
    })

    doc.save(`Atlas task performance ${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  function exportEodPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const today = eod[0]
    head(doc, 'End of day — tasks')

    if (today) {
      autoTable(doc, {
        startY: 90,
        head: [['Today', '']],
        body: [
          ['Raised', today.raised],
          ['Accepted', today.accepted],
          ['Completed', today.completed],
          ['Closed', today.closed],
          ['Overdue at day end', today.overdue_at_eod]
        ],
        theme: 'plain',
        styles: { fontSize: 11, cellPadding: 5 },
        headStyles: { fontStyle: 'bold', fillColor: [244, 246, 249] },
        columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
      })
    }

    const open = register.filter(r => !r.closed_on)
      .sort((a, b) => (b.overdue === a.overdue ? 0 : b.overdue ? 1 : -1))
      .slice(0, 40)

    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 90) + 24,
      head: [['Task', 'Responsible', 'Raised', 'Due', 'Days open', 'Status']],
      body: open.map(r => [
        `${r.task_no}\n${r.title}`,
        r.responsible_dept,
        r.raised_on || '—',
        (r.due_date || '—') + (r.overdue ? '  LATE' : ''),
        r.days_open ?? '—',
        STATUS_LABEL[r.status] || r.status
      ]),
      styles: { fontSize: 8, cellPadding: 4, valign: 'middle' },
      headStyles: { fillColor: [14, 27, 46], fontSize: 8 },
      didParseCell: c => {
        if (c.section === 'body' && c.column.index === 3 &&
            String(c.cell.raw).includes('LATE')) {
          c.cell.styles.textColor = [164, 54, 43]
          c.cell.styles.fontStyle = 'bold'
        }
      }
    })

    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 90) + 20,
      head: [['Day', 'Raised', 'Accepted', 'Completed', 'Closed', 'Overdue']],
      body: eod.slice(0, 14).map(r => [
        r.day, r.raised, r.accepted, r.completed, r.closed, r.overdue_at_eod
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [14, 27, 46], fontSize: 8 }
    })

    doc.save(`Atlas EOD tasks ${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  /* ---------- render ---------- */

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load the reports</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_task_register or dept_performance, run
          supabase/25_task_reports.sql in Supabase.
        </p>
        <button className="btn-ghost btn-sm mt-3" onClick={load}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Task reports</h1>
          <p className="text-sm text-slate2">
            Who was asked to do what, how fast they took it on, and whether it
            landed on time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={exportExcel}>Excel</button>
          <button className="btn-ghost btn-sm" onClick={exportPerformancePdf}>
            Performance PDF
          </button>
          <button className="btn-dark btn-sm" onClick={exportEodPdf}>End of day PDF</button>
        </div>
      </div>

      {/* period */}
      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (period === p.key ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {p.label}
          </button>
        ))}
      </div>

      {/* headline */}
      <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
        <Cell label="Raised" value={totals.received} />
        <Cell label="Closed" value={totals.verified} />
        <Cell label="Still open" value={totals.open} />
        <Cell label="Overdue" value={totals.overdue} bad={totals.overdue > 0} />
        <Cell label="Sent back" value={totals.reissued} bad={totals.reissued > 0} />
        <Cell label="Disputed" value={totals.disputed} bad={totals.disputed > 0} />
      </div>

      {/* who */}
      <div className="flex flex-wrap gap-1.5">
        {[['all', `Everyone (${active.length})`],
          ['department', `Departments (${depts.length})`],
          ['showroom', `Showrooms (${shops.length})`]].map(([k, l]) => (
          <button key={k} onClick={() => setWho(k)}
            className={'rounded-md px-3 py-1.5 text-sm font-medium ' +
              (who === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {l}
          </button>
        ))}
      </div>

      {/* tabs */}
      <div className="flex gap-1 rounded-md bg-paper p-1">
        {[['performance', 'Performance'], ['register', 'Register'], ['eod', 'End of day']]
          .map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={'flex-1 rounded px-3 py-1.5 text-sm font-semibold ' +
                (tab === k ? 'bg-white text-ink shadow-card' : 'text-slate2')}>
              {l}
            </button>
          ))}
      </div>

      {loading ? (
        <div className="card h-64 animate-pulse bg-line2" />
      ) : tab === 'performance' ? (
        <Performance rows={shown} />
      ) : tab === 'register' ? (
        <Register rows={regShown} status={status} setStatus={setStatus} />
      ) : (
        <Eod rows={eod} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Performance({ rows }) {
  if (!rows.length) return (
    <div className="card p-8 text-center text-sm text-slate2">
      Nothing was sent to anyone in this period.
    </div>
  )

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-4 py-2.5 text-left">Name</th>
            <th className="px-3 py-2.5 text-right">Got</th>
            <th className="px-3 py-2.5 text-right">Closed</th>
            <th className="px-3 py-2.5 text-right">Open</th>
            <th className="px-3 py-2.5 text-right">Late</th>
            <th className="px-3 py-2.5 text-right">Back</th>
            <th className="px-3 py-2.5 text-right">Disputed</th>
            <th className="px-3 py-2.5 text-right">Accept hrs</th>
            <th className="px-3 py-2.5 text-right">Close days</th>
            <th className="px-4 py-2.5 text-right">On time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.dept_code} className="border-t border-line">
              <td className="px-4 py-2.5">
                <div className="font-medium">{r.department}</div>
                {r.kind === 'showroom' && (
                  <div className="text-2xs text-slate2">showroom</div>
                )}
              </td>
              <td className="px-3 py-2.5 text-right">{r.received}</td>
              <td className="px-3 py-2.5 text-right">{r.verified}</td>
              <td className="px-3 py-2.5 text-right">{r.still_open}</td>
              <td className={'px-3 py-2.5 text-right ' +
                (Number(r.overdue) > 0 ? 'font-semibold text-bad' : '')}>{r.overdue}</td>
              <td className={'px-3 py-2.5 text-right ' +
                (Number(r.reissued) > 0 ? 'text-gold' : '')}>{r.reissued}</td>
              <td className={'px-3 py-2.5 text-right ' +
                (Number(r.disputed) > 0 ? 'text-bad' : '')}>{r.disputed}</td>
              <td className="px-3 py-2.5 text-right">
                {r.avg_hours_to_accept != null ? num(r.avg_hours_to_accept, 1) : '—'}
              </td>
              <td className="px-3 py-2.5 text-right">
                {r.avg_days_to_close != null ? num(r.avg_days_to_close, 1) : '—'}
              </td>
              <td className="px-4 py-2.5 text-right">
                {r.on_time_pct == null ? '—' : (
                  <span className={'tag ' + (r.on_time_pct >= 85 ? 'bg-good/15 text-good'
                    : r.on_time_pct >= 60 ? 'bg-warn/15 text-warn' : 'bg-bad/10 text-bad')}>
                    {num(r.on_time_pct)}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Register({ rows, status, setStatus }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="!w-auto" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">Every status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="text-xs text-slate2">{rows.length} tasks</span>
      </div>

      {!rows.length ? (
        <div className="card p-8 text-center text-sm text-slate2">
          No task matches that.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-2.5 text-left">Task</th>
                <th className="px-3 py-2.5 text-left">From</th>
                <th className="px-3 py-2.5 text-left">Responsible</th>
                <th className="px-3 py-2.5 text-left">Raised</th>
                <th className="px-3 py-2.5 text-left">Due</th>
                <th className="px-3 py-2.5 text-left">Closed</th>
                <th className="px-3 py-2.5 text-right">Days</th>
                <th className="px-3 py-2.5 text-right">Points</th>
                <th className="px-4 py-2.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.task_no} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <Link to={'/tasks/' + r.id} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    <div className="font-mono text-2xs text-slate2">
                      {r.task_no}
                      {r.schedule_name && ` · ${r.schedule_name}`}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate2">{r.raised_by_dept}</td>
                  <td className="px-3 py-2.5">{r.responsible_dept}</td>
                  <td className="px-3 py-2.5 text-slate2">{dt(r.raised_on)}</td>
                  <td className={'px-3 py-2.5 ' + (r.overdue ? 'font-semibold text-bad' : 'text-slate2')}>
                    {r.due_date ? dt(r.due_date) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-slate2">
                    {r.closed_on ? dt(r.closed_on) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.days_to_close ?? r.days_open ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate2">
                    {r.points ? `${r.points_done}/${r.points}` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs">{STATUS_LABEL[r.status] || r.status}</span>
                    {r.reissue_count > 0 && (
                      <span className="ml-1.5 tag bg-gold2 text-gold">×{r.reissue_count}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Eod({ rows }) {
  if (!rows.length) return (
    <div className="card p-8 text-center text-sm text-slate2">No days to show yet.</div>
  )
  const max = Math.max(...rows.map(r => Number(r.raised || 0)), 1)

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-4 py-2.5 text-left">Day</th>
            <th className="px-3 py-2.5 text-right">Raised</th>
            <th className="px-3 py-2.5 text-right">Accepted</th>
            <th className="px-3 py-2.5 text-right">Completed</th>
            <th className="px-3 py-2.5 text-right">Closed</th>
            <th className="px-4 py-2.5 text-right">Overdue at close</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.day} className="border-t border-line">
              <td className="px-4 py-2.5">
                <div className="font-medium">{dt(r.day)}</div>
                <div className="mt-1 h-1 w-24 rounded-full bg-line2">
                  <div className="h-1 rounded-full bg-ink"
                    style={{ width: (Number(r.raised || 0) / max) * 100 + '%' }} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-right">{r.raised}</td>
              <td className="px-3 py-2.5 text-right">{r.accepted}</td>
              <td className="px-3 py-2.5 text-right">{r.completed}</td>
              <td className="px-3 py-2.5 text-right">{r.closed}</td>
              <td className={'px-4 py-2.5 text-right ' +
                (Number(r.overdue_at_eod) > 0 ? 'font-semibold text-bad' : '')}>
                {r.overdue_at_eod}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ label, value, bad }) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={'text-xl font-semibold ' + (bad ? 'text-bad' : '')}>{value}</div>
    </div>
  )
}
