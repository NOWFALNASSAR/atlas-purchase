import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db, dt } from '../lib/db'
import { eodMessage, taskMessage } from '../lib/wa'
import { openWhatsApp } from '../lib/share'
import SendPdfSheet from '../components/SendPdfSheet'

/* ==================================================================
   END OF DAY

   Mark what mattered today and what was deliberately left, then send.

   The marking is the point. An unmarked list of forty tasks tells a
   HOD nothing — they still have to work out what to worry about. Four
   marked priorities and three marked skips is a report.
   ================================================================== */

const MARKS = [
  ['priority',   'Priority',  'bg-gold text-white'],
  ['done_today', 'Done',      'bg-good text-white'],
  ['skipped',    'Tomorrow',  'bg-slate2 text-white']
]

export default function Eod() {
  const [rows, setRows] = useState([])
  const [company, setCompany] = useState('Atlas')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)
  const [busy, setBusy] = useState(null)
  const [toast, setToast] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sending, setSending] = useState(false)

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function load() {
    setLoading(true)
    const [e, c] = await Promise.all([
      db.from('v_eod_today').select('*').order('to_dept_name'),
      db.from('settings').select('value').eq('key', 'company').maybeSingle()
    ])
    if (e.error) { setFailed(e.error.message); setLoading(false); return }
    setRows(e.data || [])
    setCompany(c.data?.value?.name || 'Atlas')
    setLoading(false)
  }

  async function mark(task, value) {
    setBusy(task.id)
    const { error } = await db.rpc('mark_task_day', {
      p_task: task.id,
      p_mark: task.mark === value ? null : value,
      p_note: null
    })
    setBusy(null)
    if (error) return setToast(error.message)
    setRows(x => x.map(r => r.id === task.id
      ? { ...r, mark: r.mark === value ? null : value } : r))
  }

  async function note(task) {
    const n = prompt('A line for the report — what happened?', task.mark_note || '')
    if (n === null) return
    const { error } = await db.rpc('mark_task_day', {
      p_task: task.id, p_mark: task.mark || 'priority', p_note: n || null
    })
    if (error) return setToast(error.message)
    load()
  }

  const counts = useMemo(() => ({
    priority: rows.filter(r => r.mark === 'priority').length,
    done:     rows.filter(r => r.mark === 'done_today' || r.closed_today).length,
    skipped:  rows.filter(r => r.mark === 'skipped').length,
    unmarked: rows.filter(r => !r.mark && !r.closed_today).length,
    overdue:  rows.filter(r => r.overdue).length
  }), [rows])

  const shown = useMemo(() => rows.filter(r => {
    if (filter === 'unmarked') return !r.mark && !r.closed_today
    if (filter === 'overdue') return r.overdue
    if (filter === 'marked') return !!r.mark
    return true
  }), [rows, filter])

  /* ---------- the PDF ---------- */

  function buildPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const today = new Date().toLocaleDateString('en-IN',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    doc.setFont('helvetica', 'bold').setFontSize(15)
    doc.text(company, 40, 44)
    doc.setFont('helvetica', 'normal').setFontSize(11)
    doc.text('End of day — tasks', 40, 63)
    doc.setFontSize(9).setTextColor(120)
    doc.text(today, 40, 78)
    doc.setTextColor(0)

    autoTable(doc, {
      startY: 96,
      body: [
        ['Raised today',   rows.filter(r => r.raised_today).length],
        ['Finished today', counts.done],
        ['Priority',       counts.priority],
        ['Left for tomorrow', counts.skipped],
        ['Overdue',        counts.overdue]
      ],
      theme: 'plain',
      styles: { fontSize: 11, cellPadding: 5 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
    })

    const section = (title, list, colour) => {
      if (!list.length) return
      autoTable(doc, {
        startY: (doc.lastAutoTable?.finalY || 96) + 22,
        head: [[`${title} (${list.length})`, 'Department', 'Due', 'Status']],
        body: list.map(r => [
          r.title + (r.mark_note ? `\n${r.mark_note}` : ''),
          r.to_dept_name,
          (r.due_date ? dt(r.due_date) : '—') + (r.overdue ? '  LATE' : ''),
          r.status
        ]),
        styles: { fontSize: 8, cellPadding: 4, valign: 'top' },
        headStyles: { fillColor: colour, fontSize: 9 },
        didParseCell: c => {
          if (c.section === 'body' && String(c.cell.raw).includes('LATE')) {
            c.cell.styles.textColor = [164, 54, 43]
            c.cell.styles.fontStyle = 'bold'
          }
        }
      })
    }

    section('Priority today', rows.filter(r => r.mark === 'priority'), [169, 119, 43])
    section('Finished', rows.filter(r => r.mark === 'done_today' || r.closed_today), [18, 112, 78])
    section('Overdue', rows.filter(r => r.overdue && r.mark !== 'skipped'), [164, 54, 43])
    section('Left for tomorrow', rows.filter(r => r.mark === 'skipped'), [91, 104, 121])

    return doc
  }

  const pdfName = () => `EOD ${new Date().toISOString().slice(0, 10)}.pdf`

  function downloadPdf() {
    buildPdf().save(pdfName())
    setToast('PDF downloaded.')
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load today</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_eod_today, run supabase/28_dept_activity_mrf_eod.sql.
        </p>
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-4 pb-28">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">End of day</h1>
          <p className="text-sm text-slate2">
            Mark what mattered and what is waiting for tomorrow, then send it to the
            HOD group.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={downloadPdf}>PDF only</button>
          <button className="btn-dark btn-sm" onClick={() => setSending(true)}>
            Send to HOD group
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-5 sm:divide-y-0">
        <Cell label="Priority" value={counts.priority} />
        <Cell label="Finished" value={counts.done} />
        <Cell label="Tomorrow" value={counts.skipped} />
        <Cell label="Overdue" value={counts.overdue} bad={counts.overdue > 0} />
        <Cell label="Not marked" value={counts.unmarked} warn={counts.unmarked > 0} />
      </div>

      {counts.unmarked > 0 && (
        <div className="rounded-md bg-gold2 px-3 py-2.5 text-sm text-gold">
          {counts.unmarked} task{counts.unmarked > 1 ? 's are' : ' is'} not marked. They
          still appear in the counts, but not in any of the named lists — so the
          report will not say what to do about them.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {[['all', `All (${rows.length})`], ['unmarked', `Not marked (${counts.unmarked})`],
          ['marked', 'Marked'], ['overdue', `Overdue (${counts.overdue})`]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={'rounded-md px-3 py-1.5 text-sm font-medium ' +
              (filter === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {l}
          </button>
        ))}
      </div>

      {loading ? <div className="card h-64 animate-pulse bg-line2" />
        : shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">Nothing here.</div>
      ) : (
        <ul className="card divide-y divide-line">
          {shown.map(t => (
            <li key={t.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={'/tasks/' + t.id}
                    className="block truncate text-sm font-medium hover:underline">
                    {t.title}
                  </Link>
                  <div className="mt-0.5 text-2xs text-slate2">
                    {t.to_dept_name}
                    {t.assigned_to_name && ` · ${t.assigned_to_name}`}
                    {t.due_date && ` · due ${dt(t.due_date)}`}
                    {t.overdue && (
                      <span className="ml-1 font-semibold text-bad">
                        {t.days_open} days open
                      </span>
                    )}
                  </div>
                  {t.mark_note && (
                    <div className="mt-1 text-xs text-ink">{t.mark_note}</div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  {MARKS.map(([k, l, on]) => (
                    <button key={k} disabled={busy === t.id}
                      onClick={() => mark(t, k)}
                      className={'rounded px-2.5 py-1 text-2xs font-semibold transition ' +
                        (t.mark === k ? on : 'border border-line bg-white text-slate2 hover:bg-paper')}>
                      {l}
                    </button>
                  ))}
                  <button onClick={() => note(t)}
                    className="rounded px-2 py-1 text-2xs font-semibold text-slate2 hover:bg-paper">
                    Note
                  </button>
                  {t.to_whatsapp && (
                    <button onClick={() => openWhatsApp(t.to_whatsapp, taskMessage(t))}
                      className="rounded px-2 py-1 text-2xs font-semibold text-good hover:bg-paper">
                      Send
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {sending && (
        <SendPdfSheet
          title="Send end of day"
          filename={pdfName()}
          message={eodMessage(rows, company)}
          build={() => buildPdf().output('blob')}
          bucket="po-pdfs"
          folder="eod"
          onClose={() => setSending(false)}
        />
      )}

      {toast && (
        <div className="fixed inset-x-4 bottom-20 z-40 rounded-lg bg-ink px-4 py-3 text-sm
                        text-white shadow-pop md:inset-x-auto md:right-6 md:bottom-6 md:max-w-sm">
          {toast}
        </div>
      )}
    </div>
  )
}

function Cell({ label, value, bad, warn }) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={'text-xl font-semibold ' +
        (bad ? 'text-bad' : warn ? 'text-warn' : '')}>{value}</div>
    </div>
  )
}
