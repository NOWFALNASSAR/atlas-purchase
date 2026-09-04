import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db, dt } from '../lib/db'
import { useMe } from '../App'
import SendPdfSheet from '../components/SendPdfSheet'

/* ==================================================================
   PLAN FOR THE DAY

   Nobody types this plan. It is assembled from work that already
   exists — what is late, what is due, what the recurring schedule
   raised this morning, what is sitting unaccepted. A plan typed by
   hand drifts from reality within a week.

   The one thing the department adds is a line per task saying what
   they will do about it today. That line is what the end-of-day report
   reads back in the evening, so it is written once and used twice.
   ================================================================== */

const BUCKETS = [
  ['overdue',  'Late',              'Past the date. These come first.',              'bg-bad/10 text-bad'],
  ['accept',   'Waiting to accept', 'Sent to you. Accept and commit a date.',        'bg-gold2 text-gold'],
  ['today',    'Due today',         'Promised for today.',                           'bg-ink/10 text-ink'],
  ['progress', 'In progress',       'Started. Add a step when something moves.',     'bg-ink/10 text-ink'],
  ['review',   'Done, with them',   'Finished and waiting for the other department.','bg-good/15 text-good'],
  ['upcoming', 'Coming up',         'Not due yet.',                                  'bg-line text-slate2']
]

const SOURCE = {
  regular:  ['Regular', 'bg-ink/10 text-ink'],
  external: ['From another department', 'bg-gold2 text-gold'],
  own:      ['Our own', 'bg-line text-slate2']
}

export default function Pfd() {
  const me = useMe()
  const [depts, setDepts] = useState([])
  const [dept, setDept] = useState(null)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [company, setCompany] = useState('Atlas')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)
  const [busy, setBusy] = useState(null)
  const [toast, setToast] = useState(null)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => { boot() }, [])
  useEffect(() => { if (dept) load(dept) }, [dept])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  async function boot() {
    const [mine, all, c] = await Promise.all([
      db.from('department_members').select('department_id, departments(id,name,code,kind,is_md_office)')
        .eq('profile_id', me.id).eq('active', true),
      db.from('v_pfd_summary').select('*').order('sort_order'),
      db.from('settings').select('value').eq('key', 'company').maybeSingle()
    ])
    setCompany(c.data?.value?.name || 'Atlas')

    const own = (mine.data || []).map(d => d.departments).filter(Boolean)
    const isMd = own.some(d => d.is_md_office)
    const list = isMd ? (all.data || []) : own.map(d =>
      (all.data || []).find(x => x.department_id === d.id) || { department_id: d.id, name: d.name })

    setDepts(list)
    setDept(list[0]?.department_id || null)
    if (!list.length) setLoading(false)
  }

  async function load(id) {
    setLoading(true)
    const [r, s] = await Promise.all([
      db.from('v_pfd').select('*').eq('department_id', id),
      db.from('v_pfd_summary').select('*').eq('department_id', id).maybeSingle()
    ])
    if (r.error) { setFailed(r.error.message); setLoading(false); return }
    setRows(r.data || [])
    setSummary(s.data || null)
    setLoading(false)
  }

  async function plan(task, text) {
    const v = text ?? prompt('What will you do about this today?', task.today_action || '')
    if (v === null) return
    setBusy(task.task_id)
    const { error } = await db.rpc('mark_task_day', {
      p_task: task.task_id,
      p_mark: v.trim() ? 'priority' : null,
      p_note: v.trim() || null
    })
    setBusy(null)
    if (error) return setToast(error.message)
    load(dept)
  }

  async function submit() {
    setBusy('submit')
    const { error } = await db.rpc('submit_pfd', { p_dept: dept, p_note: note || null })
    setBusy(null)
    if (error) return setToast(error.message)
    setToast('Plan submitted. It is on the record that this department planned today.')
    load(dept)
  }

  const grouped = useMemo(() => BUCKETS
    .map(([key, label, hint, style]) => ({
      key, label, hint, style,
      items: rows.filter(r => r.bucket === key)
        .sort((a, b) => (b.priority === 'urgent') - (a.priority === 'urgent'))
    }))
    .filter(g => g.items.length), [rows])

  const unplanned = rows.filter(r => !r.today_action).length
  const current = depts.find(d => d.department_id === dept)

  /* ---------- the PDF ---------- */

  function buildPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const today = new Date().toLocaleDateString('en-IN',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    doc.setFont('helvetica', 'bold').setFontSize(15)
    doc.text(company, 40, 44)
    doc.setFont('helvetica', 'normal').setFontSize(12)
    doc.text(`${current?.name || ''} — Plan for the day`, 40, 65)
    doc.setFontSize(9).setTextColor(120)
    doc.text(today, 40, 80)
    doc.setTextColor(0)

    autoTable(doc, {
      startY: 98,
      body: [
        ['On the plan', rows.length],
        ['Late', rows.filter(r => r.overdue).length],
        ['Waiting to accept', rows.filter(r => r.bucket === 'accept').length],
        ['Due today', rows.filter(r => r.bucket === 'today').length]
      ],
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 4 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
    })

    grouped.forEach(g => {
      autoTable(doc, {
        startY: (doc.lastAutoTable?.finalY || 98) + 18,
        head: [[`${g.label} (${g.items.length})`, 'Person', 'Due', 'Today']],
        body: g.items.map(r => [
          r.title + (r.schedule_name ? `\n(${r.schedule_name})` : ''),
          r.assigned_to_name || r.department_name,
          r.due_date ? dt(r.due_date) : '—',
          r.today_action || '—'
        ]),
        styles: { fontSize: 8, cellPadding: 4, valign: 'top' },
        headStyles: {
          fillColor: g.key === 'overdue' ? [164, 54, 43] : [14, 27, 46],
          fontSize: 9
        },
        columnStyles: { 0: { cellWidth: 190 }, 3: { cellWidth: 150 } }
      })
    })

    if (note) {
      autoTable(doc, {
        startY: (doc.lastAutoTable?.finalY || 98) + 18,
        head: [['Note from the department']],
        body: [[note]],
        styles: { fontSize: 9, cellPadding: 6 },
        headStyles: { fillColor: [91, 104, 121], fontSize: 9 }
      })
    }

    return doc
  }

  const pdfName = () =>
    `${current?.name || 'PFD'} - PFD - ${new Date().toISOString().slice(0, 10)}.pdf`

  function waMessage() {
    const late = rows.filter(r => r.overdue)
    let m = `*${current?.name} — Plan for the day*\n`
    m += new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    m += `\n\nOn the plan: ${rows.length}\nLate: ${late.length}\n`
    m += `Waiting to accept: ${rows.filter(r => r.bucket === 'accept').length}\n`
    const planned = rows.filter(r => r.today_action)
    if (planned.length) {
      m += `\n*Today*\n` + planned.map(r => `• ${r.title} — ${r.today_action}`).join('\n') + '\n'
    }
    if (late.length) {
      m += `\n*Late*\n` + late.map(r => `• ${r.title} (${r.days_open}d)`).join('\n') + '\n'
    }
    if (note) m += `\n${note}\n`
    return m + `\nFull plan attached.`
  }

  /* ---------- render ---------- */

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load the plan</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_pfd, run supabase/33_pfd.sql in Supabase.
        </p>
      </div>
    </div>
  )

  if (!loading && !depts.length) return (
    <div className="page page-md py-16 text-center">
      <div className="mb-2 text-base font-semibold">You are not in a department</div>
      <p className="text-sm text-slate2">
        The plan is per department. Ask your admin to add you to one under
        Masters → Users, Departments tab.
      </p>
    </div>
  )

  return (
    <div className="page page-xl space-y-4 pb-28">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Plan for the day</h1>
          <p className="text-sm text-slate2">
            {new Date().toLocaleDateString('en-IN',
              { weekday: 'long', day: 'numeric', month: 'long' })}
            {summary?.submitted_at && ' · submitted ' +
              new Date(summary.submitted_at).toLocaleTimeString('en-IN',
                { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        <button className="btn-dark btn-sm" onClick={() => setSending(true)}>
          Send today's plan
        </button>
      </div>

      {depts.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {depts.map(d => (
            <button key={d.department_id} onClick={() => setDept(d.department_id)}
              className={'rounded-md px-3 py-1.5 text-sm font-semibold ' +
                (dept === d.department_id
                  ? 'bg-ink text-white'
                  : 'border border-line bg-white text-slate2')}>
              {d.name}
              {d.overdue > 0 && (
                <span className={'ml-1.5 text-2xs ' +
                  (dept === d.department_id ? 'text-white/70' : 'text-bad')}>
                  {d.overdue} late
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {loading ? <div className="card h-64 animate-pulse bg-line2" /> : (
        <>
          <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Cell label="On the plan" value={rows.length} />
            <Cell label="Late" value={rows.filter(r => r.overdue).length}
              bad={rows.some(r => r.overdue)} />
            <Cell label="To accept" value={rows.filter(r => r.bucket === 'accept').length} />
            <Cell label="Not planned yet" value={unplanned} warn={unplanned > 0} />
          </div>

          {rows.length === 0 && (
            <div className="card p-8 text-center">
              <div className="mb-1 text-base font-semibold">Nothing on the plan today</div>
              <p className="text-sm text-slate2">
                No open work for this department. Submit anyway so it is on the
                record that the day was planned.
              </p>
            </div>
          )}

          {grouped.map(g => (
            <section key={g.key}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">
                  {g.label}
                  <span className="ml-2 text-2xs font-normal text-slate2">
                    {g.items.length} · {g.hint}
                  </span>
                </h2>
              </div>

              <ul className="card divide-y divide-line">
                {g.items.map(r => (
                  <li key={r.task_id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <Link to={'/tasks/' + r.task_id}
                          className="text-sm font-medium hover:underline">
                          {r.title}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-slate2">
                          <span className={'tag ' + SOURCE[r.source][1]}>{SOURCE[r.source][0]}</span>
                          {r.priority !== 'normal' && (
                            <span className="tag bg-gold2 text-gold">{r.priority}</span>
                          )}
                          <span>{r.assigned_to_name || 'anyone in the department'}</span>
                          {r.due_date && <span>· due {dt(r.due_date)}</span>}
                          {r.overdue && (
                            <span className="font-semibold text-bad">· {r.days_open} days open</span>
                          )}
                          {r.points > 0 && <span>· {r.points_done}/{r.points} points</span>}
                        </div>
                      </div>
                      <span className={'tag ' + g.style}>{g.label}</span>
                    </div>

                    <button onClick={() => plan(r)} disabled={busy === r.task_id}
                      className={'mt-2 w-full rounded-md border px-3 py-2 text-left text-sm transition ' +
                        (r.today_action
                          ? 'border-line bg-paper'
                          : 'border-dashed border-line text-slate2 hover:border-mute')}>
                      {r.today_action || 'What will you do about this today?'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {rows.length > 0 && (
            <div className="card p-4">
              <label>Anything else about today</label>
              <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
                placeholder="Short staffed, waiting on a supplier, and so on" />
            </div>
          )}

          <div className="fixed inset-x-0 bottom-[3.25rem] z-30 border-t border-line bg-white px-4 py-3 shadow-pop md:static md:border-0 md:bg-transparent md:px-0 md:shadow-none">
            <div className="page page-xl flex items-center gap-3">
              <span className="flex-1 text-xs text-slate2">
                {unplanned > 0
                  ? `${unplanned} task${unplanned > 1 ? 's have' : ' has'} no plan for today.`
                  : summary?.submitted_at
                    ? 'Submitted. Submit again if anything changes.'
                    : 'Every task has a plan.'}
              </span>
              <button className="btn-dark" disabled={busy === 'submit'} onClick={submit}>
                {busy === 'submit' ? 'Submitting' : summary?.submitted_at ? 'Update plan' : 'Submit plan'}
              </button>
            </div>
          </div>
        </>
      )}

      {sending && (
        <SendPdfSheet
          title="Send the plan"
          filename={pdfName()}
          message={waMessage()}
          number={current?.whatsapp}
          numberLabel={current?.name}
          build={() => buildPdf().output('blob')}
          bucket="po-pdfs"
          folder={'pfd/' + dept}
          onClose={() => setSending(false)}
        />
      )}

      {toast && (
        <div className="fixed inset-x-4 bottom-32 z-40 rounded-lg bg-ink px-4 py-3 text-sm
                        text-white shadow-pop md:inset-x-auto md:bottom-6 md:right-6 md:max-w-sm">
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
      <div className={'text-xl font-semibold ' + (bad ? 'text-bad' : warn ? 'text-warn' : '')}>
        {value}
      </div>
    </div>
  )
}
