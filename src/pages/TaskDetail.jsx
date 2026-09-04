import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { db, dt, dtTime } from '../lib/db'
import { useMe, useCan } from '../App'
import TaskMedia from '../components/TaskMedia'
import Picker from '../components/Picker'
import { taskMessage } from '../lib/wa'
import SendPdfSheet from '../components/SendPdfSheet'
import { buildTaskPdf } from '../lib/taskPdf'

const LABEL = {
  raised: 'New', reissued: 'Reissued', acknowledged: 'Accepted',
  in_progress: 'In progress', completed: 'Done, awaiting check',
  verified: 'Closed', cancelled: 'Cancelled', disputed: 'With MD Office'
}
const STYLE = {
  raised: 'bg-gold/15 text-gold', reissued: 'bg-bad/10 text-bad',
  acknowledged: 'bg-ink/10 text-ink', in_progress: 'bg-ink/10 text-ink',
  completed: 'bg-good/15 text-good', verified: 'bg-good/15 text-good',
  cancelled: 'bg-line text-slate2', disputed: 'bg-bad/10 text-bad'
}

export default function TaskDetail() {
  const { id } = useParams()
  const me = useMe()
  const can = useCan()

  const [t, setT] = useState(null)
  const [events, setEvents] = useState([])
  const [points, setPoints] = useState([])
  const [notes, setNotes] = useState([])
  const [previous, setPrevious] = useState(null)
  const [mrf, setMrf] = useState(null)
  const [waNo, setWaNo] = useState(null)
  const [sending, setSending] = useState(false)
  const [mayEdit, setMayEdit] = useState(false)
  const [depts, setDepts] = useState([])
  const [myDepts, setMyDepts] = useState([])
  const [isMD, setIsMD] = useState(false)

  const [accept, setAccept] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    const [task, ev, cl, nt, prev, dm, dp, mr] = await Promise.all([
      db.from('v_task_full').select('*').eq('id', id).maybeSingle(),
      db.from('task_events').select('*').eq('task_id', id).order('created_at'),
      db.from('task_checklist').select('*').eq('task_id', id).order('sort_order'),
      db.from('task_notes').select('*, profiles(full_name)').eq('task_id', id)
        .order('created_at', { ascending: false }),
      db.from('v_task_previous').select('*').eq('task_id', id).maybeSingle(),
      db.from('department_members').select('department_id, departments(is_md_office)')
        .eq('profile_id', me.id).eq('active', true),
      db.from('departments').select('id,name,code,kind,whatsapp').eq('active', true).order('sort_order'),
      db.from('task_mrf').select('*').eq('task_id', id).maybeSingle()
    ])

    if (!task.data) { setGone(true); return }
    setT(task.data)
    setEvents(ev.data || [])
    setPoints(cl.data || [])
    setNotes(nt.data || [])
    setPrevious(prev.data || null)
    setMyDepts((dm.data || []).map(d => d.department_id))
    setIsMD((dm.data || []).some(d => d.departments?.is_md_office))
    setDepts(dp.data || [])
    setMrf(mr.data || null)
    db.rpc('can_edit_task', { p_task: id }).then(({ data }) => setMayEdit(data === true))
    setWaNo((dp.data || []).find(d => d.id === task.data.to_dept)?.whatsapp || null)
  }

  if (gone) return (
    <div className="page page-md py-16 text-center">
      <div className="mb-2 text-base font-semibold">Task not found</div>
      <p className="text-sm text-slate2">
        It may have been cancelled, or it belongs to a department you are not in.
      </p>
      <Link to="/tasks" className="btn-ghost mt-4">Back to tasks</Link>
    </div>
  )

  if (!t) return <div className="py-16 text-center text-sm text-slate2">Loading task</div>

  const holding  = myDepts.includes(t.to_dept) || isMD      // answerable now
  const asking   = myDepts.includes(t.from_dept) || isMD    // raised it
  const involved = holding || asking ||
                   (t.support_depts || []).length > 0       // supporting
  const open = !['verified', 'cancelled'].includes(t.status)


  async function call(fn, args, ok) {
    setBusy(true)
    const { error } = await db.rpc(fn, args)
    setBusy(false)
    if (error) return alert(error.message)
    if (ok) alert(ok)
    load()
  }

  async function addNote() {
    if (!note.trim()) return
    setBusy(true)
    const { error } = await db.from('task_notes')
      .insert({ task_id: t.id, note: note.trim(), author_id: me.id })
    setBusy(false)
    if (error) return alert(error.message)
    setNote(''); load()
  }

  async function tick(item) {
    const { error } = await db.rpc('tick_checklist',
      { p_item: item.id, p_done: !item.done, p_note: null })
    if (error) return alert(error.message)
    load()
  }

  function doAccept() {
    if (!accept?.start || !accept?.finish) return alert('Give both dates')
    call('acknowledge_task', {
      p_task: t.id, p_start: accept.start, p_finish: accept.finish,
      p_note: accept.note || null
    })
    setAccept(null)
  }

  function doDispute() {
    const why = prompt('Why does this belong to another department?')
    if (why?.trim()) call('dispute_task', { p_task: t.id, p_reason: why },
      'Sent to MD Office to decide.')
  }


  const donePoints = points.filter(p => p.done).length

  return (
    <div className="page page-md space-y-4">

      {/* ---------- header ---------- */}
      <div className="card overflow-hidden">
        <div className="bg-ink p-4 text-white">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{t.title}</div>
              <div className="font-mono text-2xs text-white/60">{t.task_no}</div>
              <div className="mt-1 text-xs text-white/70">
                {t.from_dept_name} → {t.to_dept_name}
                {t.assigned_to_name && ` · ${t.assigned_to_name}`}
              </div>
              {t.schedule_name && (
                <div className="mt-1 text-2xs text-white/50">
                  Recurring · {t.schedule_name}
                  {t.occurrence_date && ` · ${dt(t.occurrence_date)}`}
                </div>
              )}
            </div>
            <span className={'tag ' + STYLE[t.status]}>{LABEL[t.status]}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-line border-b border-line md:grid-cols-4">
          <Cell label="Raised" value={dt(t.created_at)} />
          <Cell label="Needed by" value={t.due_date ? dt(t.due_date) : '—'} warn={t.overdue} />
          <Cell label="Planned finish" value={t.planned_finish ? dt(t.planned_finish) : 'not set'} />
          <Cell label="Finished" value={t.actual_finish ? dt(t.actual_finish) : '—'}
            warn={t.finished_late} />
        </div>

        {t.details && (
          <div className="whitespace-pre-wrap border-b border-line px-4 py-3 text-sm">
            {t.details}
          </div>
        )}

        {(t.support_depts || []).length > 0 && (
          <div className="border-b border-line px-4 py-2.5 text-xs">
            <span className="text-slate2">Also involved: </span>
            {t.support_depts.join(', ')}
            <span className="block text-2xs text-slate2">
              {t.to_dept_name} is answerable for this task.
            </span>
          </div>
        )}

        <div className="px-4 py-2 text-2xs text-slate2">
          Raised by {t.raised_by_name}
          {t.shop_name && ` · ${t.shop_name}`}
          {t.priority !== 'normal' && ` · ${t.priority} priority`}
        </div>

        {(t.ack_overdue || t.overdue) && (
          <div className="bg-bad/10 px-4 py-2 text-sm font-semibold text-bad">
            {t.ack_overdue && 'Not accepted within 24 hours. '}
            {t.overdue && 'Past the date it was needed by.'}
          </div>
        )}

        {t.status === 'disputed' && (
          <div className="bg-bad/10 px-4 py-3 text-sm text-bad">
            <div className="font-semibold">
              {t.disputed_from_name} says this is not their work
            </div>
            {t.dispute_note && <div className="mt-0.5">{t.dispute_note}</div>}
            <div className="mt-1 text-2xs">
              MD Office decides who it goes to.
            </div>
          </div>
        )}

        {t.reissue_count > 0 && (
          <div className="bg-gold2 px-4 py-2 text-sm text-gold">
            Reissued {t.reissue_count} time{t.reissue_count > 1 ? 's' : ''}
            {t.reissue_note && ` — ${t.reissue_note}`}
          </div>
        )}
      </div>

      {/* ---------- manpower request ---------- */}
      {mrf && (
        <section className="card border-gold/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gold">Manpower request</h2>
          <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
            <Field k="Position" v={mrf.position} />
            <Field k="How many" v={mrf.headcount} />
            <Field k="Type" v={(mrf.employment || '').replace('_', ' ')} />
            <Field k="For" v={depts.find(d => d.id === mrf.for_department)?.name} />
            <Field k="Salary" v={
              (mrf.salary_min || mrf.salary_max)
                ? [mrf.salary_min, mrf.salary_max].filter(Boolean)
                    .map(x => '₹' + Number(x).toLocaleString('en-IN')).join(' to ')
                  + ' per ' + mrf.salary_period
                : null} />
            <Field k="Needed by" v={mrf.expected_by ? dt(mrf.expected_by) : null} />
            <Field k="Qualification" v={mrf.qualification} />
            <Field k="Experience" v={mrf.experience} />
            <Field k="Replacing" v={mrf.replacing} />
          </dl>
          {mrf.reason && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="stat-label">Why</div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{mrf.reason}</p>
            </div>
          )}
        </section>
      )}

      {/* ---------- send it ---------- */}
      {involved && open && (
        <button className="btn-ghost w-full"
          onClick={() => openWhatsApp(waNo, taskMessage(t, mrf))}>
          {waNo
            ? `Send to ${t.to_dept_name} on WhatsApp`
            : 'Send on WhatsApp — pick the number'}
        </button>
      )}
      {involved && open && !waNo && (
        <p className="-mt-1 text-center text-2xs text-slate2">
          {t.to_dept_name} has no WhatsApp number saved, so you will have to choose
          the contact. Add one on Masters → Departments to make it one tap.
        </p>
      )}

      {/* ---------- what happened last time ---------- */}
      {previous?.previous_notes && (
        <section className="card border-gold/40 p-4">
          <h2 className="mb-1 text-sm font-semibold text-gold">
            Last time — {dt(previous.occurrence_date)}
          </h2>
          <p className="mb-2 text-2xs text-slate2">
            Written by whoever did this task on the previous round.
          </p>
          <div className="whitespace-pre-wrap rounded-md bg-gold2 p-3 text-sm">
            {previous.previous_notes}
          </div>
          <Link to={'/tasks/' + previous.previous_task_id}
            className="mt-2 inline-block text-xs font-medium text-gold">
            Open that task
          </Link>
        </section>
      )}

      {/* ---------- sub-points ---------- */}
      {points.length > 0 && (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Sub-points</h2>
            <span className="text-xs text-slate2">{donePoints} of {points.length} done</span>
          </div>

          <div className="h-1 bg-line2">
            <div className="h-1 bg-good transition-all"
              style={{ width: (points.length ? donePoints / points.length * 100 : 0) + '%' }} />
          </div>

          <ul className="divide-y divide-line">
            {points.map(p => (
              <li key={p.id}>
                <label className={'flex items-start gap-3 px-4 py-3 ' +
                  (involved && open ? 'cursor-pointer hover:bg-paper' : '')}>
                  <input type="checkbox" className="!w-auto mt-0.5" checked={p.done}
                    disabled={!involved || !open} onChange={() => tick(p)} />
                  <span className="min-w-0 flex-1">
                    <span className={'block text-sm ' + (p.done ? 'text-slate2 line-through' : '')}>
                      {p.label}
                    </span>
                    {p.done && p.done_at && (
                      <span className="block text-2xs text-slate2">{dtTime(p.done_at)}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- notes ---------- */}
      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold">Notes</h2>
        <p className="mb-3 text-2xs text-slate2">
          Write what actually happened. Next time this task comes round, whoever
          picks it up reads this first.
        </p>

        {involved && open && (
          <div className="mb-3 space-y-2">
            <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
              placeholder="What did you find, what did you do, what is still pending" />
            <button className="btn-dark btn-sm" disabled={busy || !note.trim()} onClick={addNote}>
              Add note
            </button>
          </div>
        )}

        {notes.length === 0 ? (
          <p className="text-sm text-slate2">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map(n => (
              <li key={n.id} className="border-l-2 border-line pl-3">
                <div className="whitespace-pre-wrap text-sm">{n.note}</div>
                <div className="mt-0.5 text-2xs text-slate2">
                  {n.profiles?.full_name || 'Someone'} · {dtTime(n.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- media ---------- */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Photos and voice</h2>
        <TaskMedia taskId={t.id} editable={involved && open} />
      </section>

      {/* ---------- doing the work ----------
           Accepting, starting and finishing stay here, because they
           belong to the people doing the job. Everything that CHANGES
           the task — dates, department, cancelling — is on its own
           screen, so nobody taps cancel while reading. */}
      <div className="space-y-2">

        {holding && ['raised', 'reissued'].includes(t.status) && (
          accept ? (
            <div className="card space-y-3 p-4">
              <h3 className="text-sm font-semibold">When will this be done?</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Start</label>
                  <input type="date" value={accept.start}
                    onChange={e => setAccept(v => ({ ...v, start: e.target.value }))} />
                </div>
                <div>
                  <label>Finish</label>
                  <input type="date" value={accept.finish}
                    onChange={e => setAccept(v => ({ ...v, finish: e.target.value }))} />
                </div>
              </div>
              <div>
                <label>Note (optional)</label>
                <input value={accept.note}
                  onChange={e => setAccept(v => ({ ...v, note: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-dark" onClick={doAccept} disabled={busy}>Accept task</button>
                <button className="btn-ghost" onClick={() => setAccept(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <button className="btn-gold"
                onClick={() => setAccept({ start: new Date().toISOString().slice(0, 10),
                                           finish: t.due_date || '', note: '' })}>
                Accept and set dates
              </button>
              <button className="btn-ghost" disabled={busy} onClick={doDispute}>
                Not our work
              </button>
            </div>
          )
        )}

        {holding && t.status === 'acknowledged' && (
          <button className="btn-dark w-full" disabled={busy}
            onClick={() => call('start_task', { p_task: t.id, p_note: null })}>
            Start work
          </button>
        )}

        {holding && ['acknowledged', 'in_progress'].includes(t.status) && (
          <>
            {points.length > 0 && donePoints < points.length && (
              <p className="rounded-md bg-gold2 px-3 py-2 text-xs text-gold">
                {points.length - donePoints} sub-point
                {points.length - donePoints > 1 ? 's are' : ' is'} still unticked. You can
                still mark the task done, but say why in a note first.
              </p>
            )}
            <button className="btn-gold w-full" disabled={busy}
              onClick={() => call('complete_task', {
                p_task: t.id, p_note: prompt('Anything to note? (optional)') || null })}>
              Mark as done
            </button>
          </>
        )}

        {involved && open && (
          <button className="btn-ghost w-full" onClick={() => setSending(true)}>
            Send this task on WhatsApp
          </button>
        )}

        {/* everything that changes the task lives elsewhere */}
        {mayEdit && open && (
          <Link to={`/tasks/${t.id}/manage`} className="btn-ghost w-full">
            Manage this task
          </Link>
        )}

        {!mayEdit && open && involved && (
          <p className="text-center text-2xs text-slate2">
            Need the dates moved, or this sent elsewhere? Add a note above — MD Office
            reads it and makes the change.
          </p>
        )}
      </div>

      {/* ---------- history ---------- */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">History</h2>
        <ol className="space-y-2.5">
          {events.map(e => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className={'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ' +
                (e.action === 'disputed' ? 'bg-bad'
                  : e.action === 'reassigned' ? 'bg-gold' : 'bg-ink')} />
              <span className="flex-1">
                <span className="font-semibold capitalize">{e.action.replace(/_/g, ' ')}</span>
                {e.note && <span className="text-slate2"> — {e.note}</span>}
                <span className="block text-2xs text-slate2">
                  {e.actor_name || 'system'} · {dtTime(e.created_at)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <Link to="/tasks" className="block text-center text-sm font-medium text-slate2">
        Back to tasks
      </Link>

      {sending && (
        <SendPdfSheet
          title={'Send ' + t.task_no}
          filename={buildTaskPdf(t, points, notes, events, mrf).filename}
          message={taskMessage(t, mrf)}
          number={waNo}
          numberLabel={t.to_dept_name}
          build={() => buildTaskPdf(t, points, notes, events, mrf).blob}
          bucket="po-pdfs"
          folder={'tasks/' + t.id}
          onClose={() => setSending(false)}
        />
      )}
    </div>
  )
}

function Field({ k, v }) {
  if (!v) return null
  return (
    <div>
      <dt className="stat-label">{k}</dt>
      <dd className="text-sm font-medium">{v}</dd>
    </div>
  )
}

function Cell({ label, value, warn }) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={'text-sm font-semibold ' + (warn ? 'text-bad' : '')}>{value}</div>
    </div>
  )
}
