import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db, dt, inr, num } from '../lib/db'

/* ==================================================================
   MANPOWER REPORT

   Not "how many tasks are open" but the questions a business actually
   asks about hiring:

     how many positions are we short
     when was each one asked for
     when was it needed by
     how long has it been sitting there
     what did HR last do about it, and how long ago
   ================================================================== */

const STAGES = [
  ['requested',    'Requested',    'bg-line text-slate2'],
  ['approved',     'Approved',     'bg-ink/10 text-ink'],
  ['sourcing',     'Sourcing',     'bg-ink/10 text-ink'],
  ['shortlisted',  'Shortlisted',  'bg-gold2 text-gold'],
  ['interviewing', 'Interviewing', 'bg-gold2 text-gold'],
  ['offered',      'Offered',      'bg-good/15 text-good'],
  ['joined',       'Joined',       'bg-good text-white'],
  ['on_hold',      'On hold',      'bg-warn/15 text-warn'],
  ['cancelled',    'Cancelled',    'bg-line text-slate2']
]

const stageStyle = s => STAGES.find(x => x[0] === s)?.[2] || 'bg-line text-slate2'
const stageLabel = s => STAGES.find(x => x[0] === s)?.[1] || s

export default function MrfReport() {
  const [rows, setRows] = useState([])
  const [sum, setSum] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)
  const [show, setShow] = useState('open')
  const [busy, setBusy] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [r, s] = await Promise.all([
      db.from('v_mrf_report').select('*').order('opened_on', { ascending: false }),
      db.from('v_mrf_summary').select('*').maybeSingle()
    ])
    if (r.error) { setFailed(r.error.message); setLoading(false); return }
    setRows(r.data || [])
    setSum(s.data || null)
    setLoading(false)
  }

  async function move(row, stage) {
    const note = prompt(
      `What did you do? (this becomes the action on the report)`,
      stageLabel(stage))
    if (note === null) return

    let joined = null, filled = null
    if (stage === 'joined') {
      joined = prompt('Joining date (YYYY-MM-DD)', new Date().toISOString().slice(0, 10))
      if (joined === null) return
      const n = prompt(`How many joined? (asked for ${row.headcount})`, String(row.headcount))
      filled = n === null ? null : Number(n)
    }

    setBusy(row.task_id)
    const { error } = await db.rpc('set_mrf_stage', {
      p_task: row.task_id, p_stage: stage, p_note: note || null,
      p_candidate: null, p_joined: joined || null, p_filled: filled
    })
    setBusy(null)
    if (error) return alert(error.message)
    load()
  }

  const shown = useMemo(() => rows.filter(r => (
    show === 'open'     ? !r.is_closed
    : show === 'overdue' ? r.overdue
    : show === 'stale'   ? !r.is_closed && (r.days_since_action ?? 999) > 7
    : show === 'closed'  ? r.is_closed
    : true
  )), [rows, show])

  const salary = r => (r.salary_min || r.salary_max)
    ? [r.salary_min, r.salary_max].filter(Boolean).map(v => inr(v)).join(' – ')
      + ' /' + r.salary_period
    : '—'

  function exportExcel() {
    const sheet = XLSX.utils.json_to_sheet(rows.map(r => ({
      Position: r.position, 'For': r.for_dept, 'Raised by': r.raised_by_dept,
      Asked: r.headcount, Filled: r.filled_count, 'Still open': r.still_open,
      Type: r.employment, Stage: stageLabel(r.stage),
      Opened: r.opened_on, 'Needed by': r.needed_by, Joined: r.joined_on,
      Closed: r.closed_on,
      'Days open': r.days_open, 'Days to fill': r.days_to_fill,
      'Days past needed': r.days_past_needed,
      'Last action': r.last_action,
      'Days since action': r.days_since_action,
      Salary: salary(r), Qualification: r.qualification, Experience: r.experience,
      Replacing: r.replacing, Reason: r.reason, Task: r.task_no
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Manpower')
    XLSX.writeFile(wb, `Manpower report ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function exportPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
    doc.setFont('helvetica', 'bold').setFontSize(14)
    doc.text('Manpower requisition report', 40, 40)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(120)
    doc.text(new Date().toLocaleString('en-IN'), 40, 57)
    doc.setTextColor(0)

    if (sum) {
      autoTable(doc, {
        startY: 74,
        body: [[
          `Open positions: ${sum.open_positions}`,
          `Open requests: ${sum.open_requests}`,
          `Overdue: ${sum.overdue}`,
          `Joined: ${sum.joined}`,
          `Avg days to fill: ${sum.avg_days_to_fill ?? '—'}`
        ]],
        theme: 'plain', styles: { fontSize: 9, cellPadding: 4 }
      })
    }

    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 74) + 14,
      head: [['Position', 'For', 'Asked', 'Filled', 'Opened', 'Needed by',
              'Days open', 'Stage', 'Last action', 'Days since']],
      body: shown.map(r => [
        r.position, r.for_dept || '—', r.headcount, r.filled_count,
        r.opened_on, (r.needed_by || '—') + (r.overdue ? '  LATE' : ''),
        r.days_open, stageLabel(r.stage),
        r.last_action || '—', r.days_since_action ?? '—'
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [14, 27, 46], fontSize: 8 },
      alternateRowStyles: { fillColor: [246, 248, 250] },
      didParseCell: c => {
        if (c.section === 'body' && String(c.cell.raw).includes('LATE')) {
          c.cell.styles.textColor = [164, 54, 43]
          c.cell.styles.fontStyle = 'bold'
        }
      }
    })

    doc.save(`Manpower report ${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load the manpower report</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_mrf_report, run supabase/29_mrf_report.sql in Supabase.
        </p>
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Manpower</h1>
          <p className="text-sm text-slate2">
            Positions asked for, how long they have been open, and what HR did last.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={exportExcel}>Excel</button>
          <button className="btn-dark btn-sm" onClick={exportPdf}>PDF</button>
        </div>
      </div>

      {sum && (
        <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
          <Cell label="Positions open" value={sum.open_positions} big />
          <Cell label="Requests open" value={sum.open_requests} />
          <Cell label="Past the date" value={sum.overdue} bad={sum.overdue > 0} />
          <Cell label="Joined" value={sum.joined} />
          <Cell label="Avg days to fill"
            value={sum.avg_days_to_fill != null ? num(sum.avg_days_to_fill, 1) : '—'} />
          <Cell label="No action 7 days" value={sum.untouched_over_a_week}
            bad={sum.untouched_over_a_week > 0} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {[['open', `Open (${rows.filter(r => !r.is_closed).length})`],
          ['overdue', `Past the date (${rows.filter(r => r.overdue).length})`],
          ['stale', `No action 7 days (${rows.filter(r => !r.is_closed && (r.days_since_action ?? 999) > 7).length})`],
          ['closed', `Closed (${rows.filter(r => r.is_closed).length})`],
          ['all', `All (${rows.length})`]].map(([k, l]) => (
          <button key={k} onClick={() => setShow(k)}
            className={'rounded-md px-3 py-1.5 text-sm font-medium ' +
              (show === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {l}
          </button>
        ))}
      </div>

      {loading ? <div className="card h-64 animate-pulse bg-line2" />
        : shown.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="mb-1 text-base font-semibold">Nothing here</div>
          <p className="text-sm text-slate2">
            Manpower requests appear once somebody raises a task and picks
            “MRF — manpower request” as the type.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map(r => (
            <li key={r.task_id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={'/tasks/' + r.task_id}
                    className="text-base font-semibold hover:underline">
                    {r.position}
                  </Link>
                  <div className="mt-0.5 text-xs text-slate2">
                    {r.for_dept} · asked by {r.raised_by_dept}
                    {r.replacing && ` · replacing ${r.replacing}`}
                    {' · '}<span className="font-mono">{r.task_no}</span>
                  </div>
                </div>
                <span className={'tag ' + stageStyle(r.stage)}>{stageLabel(r.stage)}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4 lg:grid-cols-6">
                <F k="Asked for" v={`${r.headcount} ${r.headcount === 1 ? 'person' : 'people'}`} />
                <F k="Filled" v={`${r.filled_count} of ${r.headcount}`} />
                <F k="Opened" v={dt(r.opened_on)} />
                <F k="Needed by" v={r.needed_by ? dt(r.needed_by) : '—'} bad={r.overdue} />
                <F k="Days open" v={r.days_open} bad={r.days_open > 30 && !r.is_closed} />
                <F k={r.days_to_fill != null ? 'Days to fill' : 'Salary'}
                   v={r.days_to_fill != null ? r.days_to_fill : salary(r)} />
              </div>

              {r.overdue && (
                <div className="mt-3 rounded-md bg-bad/10 px-3 py-2 text-xs font-semibold text-bad">
                  {r.days_past_needed} days past the date {r.for_dept} asked for.
                </div>
              )}

              <div className="mt-3 border-t border-line pt-3">
                <div className="stat-label">Last action by HR</div>
                {r.last_action ? (
                  <div className="mt-0.5 text-sm">
                    {r.last_action}
                    <span className="ml-2 text-xs text-slate2">
                      {r.days_since_action === 0 ? 'today'
                        : `${r.days_since_action} day${r.days_since_action === 1 ? '' : 's'} ago`}
                    </span>
                    {r.days_since_action > 7 && !r.is_closed && (
                      <span className="ml-2 tag bg-bad/10 text-bad">stalled</span>
                    )}
                  </div>
                ) : (
                  <div className="mt-0.5 text-sm text-bad">
                    Nothing recorded yet — HR has not touched this.
                  </div>
                )}
                {r.candidate && (
                  <div className="mt-1 text-xs text-slate2">Candidate: {r.candidate}</div>
                )}
                {r.joined_on && (
                  <div className="mt-1 text-xs text-good">Joined {dt(r.joined_on)}</div>
                )}
              </div>

              {!r.is_closed && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {STAGES.filter(([k]) => k !== r.stage).map(([k, l]) => (
                    <button key={k} disabled={busy === r.task_id}
                      onClick={() => move(r, k)}
                      className="rounded border border-line bg-white px-2.5 py-1 text-2xs
                                 font-semibold text-slate2 hover:bg-paper hover:text-ink">
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Cell({ label, value, bad, big }) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={(big ? 'text-2xl' : 'text-xl') + ' font-semibold ' + (bad ? 'text-bad' : '')}>
        {value}
      </div>
    </div>
  )
}

function F({ k, v, bad }) {
  return (
    <div>
      <div className="stat-label">{k}</div>
      <div className={'text-sm font-medium ' + (bad ? 'text-bad' : '')}>{v}</div>
    </div>
  )
}
