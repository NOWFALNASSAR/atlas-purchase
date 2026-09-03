import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { db, dt, dtTime } from '../lib/db'
import { useMe } from '../App'
import TaskMedia from '../components/TaskMedia'

const LABEL = {
  raised: 'New', reissued: 'Reissued', acknowledged: 'Accepted',
  in_progress: 'In progress', completed: 'Done, awaiting check',
  verified: 'Closed', cancelled: 'Cancelled'
}
const STYLE = {
  raised: 'bg-gold/15 text-gold', reissued: 'bg-bad/10 text-bad',
  acknowledged: 'bg-ink/10 text-ink', in_progress: 'bg-ink/10 text-ink',
  completed: 'bg-good/15 text-good', verified: 'bg-good/15 text-good',
  cancelled: 'bg-line text-slate2'
}

export default function TaskDetail() {
  const { id } = useParams()
  const me = useMe()
  const [t, setT] = useState(null)
  const [events, setEvents] = useState([])
  const [myDepts, setMyDepts] = useState([])
  const [isMD, setIsMD] = useState(false)
  const [accept, setAccept] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: task }, { data: ev }, { data: dm }] = await Promise.all([
      db.from('v_tasks').select('*').eq('id', id).single(),
      db.from('task_events').select('*').eq('task_id', id).order('created_at'),
      db.from('department_members').select('department_id, departments(is_md_office)')
        .eq('profile_id', me.id).eq('active', true)
    ])
    setT(task); setEvents(ev || [])
    setMyDepts((dm || []).map(d => d.department_id))
    setIsMD((dm || []).some(d => d.departments?.is_md_office))
  }

  if (!t) return <div className="py-16 text-center text-sm text-slate2">Loading task</div>

  const isReceiver = myDepts.includes(t.to_dept) || isMD
  const isRaiser = myDepts.includes(t.from_dept) || isMD

  async function call(fn, args, ok) {
    setBusy(true)
    const { error } = await db.rpc(fn, args)
    setBusy(false)
    if (error) return alert(error.message)
    if (ok) alert(ok)
    load()
  }

  const doAccept = () => {
    if (!accept?.start || !accept?.finish) return alert('Give both dates')
    call('acknowledge_task', {
      p_task: t.id, p_start: accept.start, p_finish: accept.finish,
      p_note: accept.note || null
    })
    setAccept(null)
  }

  return (
    <div className="page page-md space-y-4">
      {/* header */}
      <div className="card overflow-hidden">
        <div className="bg-ink p-4 text-white">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold">{t.title}</div>
              <div className="font-mono text-[11px] text-white/60">{t.task_no}</div>
              <div className="mt-1 text-[12px] text-white/70">
                {t.from_dept_name} → {t.to_dept_name}
                {t.assigned_to_name && ` · ${t.assigned_to_name}`}
              </div>
            </div>
            <span className={'tag ' + STYLE[t.status]}>{LABEL[t.status]}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-line border-b border-line md:grid-cols-4">
          <Cell label="Raised" value={dt(t.created_at)} />
          <Cell label="Needed by" value={t.due_date ? dt(t.due_date) : '—'} warn={t.overdue} />
          <Cell label="Planned finish"
            value={t.planned_finish ? dt(t.planned_finish) : 'not set'} />
          <Cell label="Finished"
            value={t.actual_finish ? dt(t.actual_finish) : '—'} warn={t.finished_late} />
        </div>

        {t.details && (
          <div className="border-b border-line px-4 py-3 text-[13px] whitespace-pre-wrap">
            {t.details}
          </div>
        )}

        <div className="px-4 py-2 text-[11px] text-slate2">
          Raised by {t.raised_by_name}
          {t.shop_name && ` · ${t.shop_name}`}
          {t.priority !== 'normal' && ` · ${t.priority} priority`}
        </div>

        {(t.ack_overdue || t.overdue) && (
          <div className="bg-bad/10 px-4 py-2 text-[13px] font-semibold text-bad">
            {t.ack_overdue && 'Not accepted within 24 hours. '}
            {t.overdue && 'Past the date it was needed by.'}
          </div>
        )}

        {t.reissue_count > 0 && (
          <div className="bg-gold/10 px-4 py-2 text-[13px] text-gold">
            Reissued {t.reissue_count} time{t.reissue_count > 1 ? 's' : ''}
            {t.reissue_note && ` — ${t.reissue_note}`}
          </div>
        )}
      </div>

      {/* media */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold">Photos and voice</h2>
        <TaskMedia taskId={t.id}
          editable={(isReceiver || isRaiser) && !['verified','cancelled'].includes(t.status)} />
      </section>

      {/* actions */}
      <div className="space-y-2">
        {/* receiver accepts and sets dates */}
        {isReceiver && ['raised', 'reissued'].includes(t.status) && (
          accept ? (
            <div className="card space-y-3 p-4">
              <h3 className="text-sm font-bold">When will this be done?</h3>
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
            <button className="btn-gold w-full"
              onClick={() => setAccept({ start: new Date().toISOString().slice(0,10),
                                         finish: t.due_date || '', note: '' })}>
              Accept and set dates
            </button>
          )
        )}

        {isReceiver && t.status === 'acknowledged' && (
          <button className="btn-dark w-full" disabled={busy}
            onClick={() => call('start_task', { p_task: t.id, p_note: null })}>
            Start work
          </button>
        )}

        {isReceiver && ['acknowledged', 'in_progress'].includes(t.status) && (
          <button className="btn-gold w-full" disabled={busy}
            onClick={() => call('complete_task', {
              p_task: t.id, p_note: prompt('Anything to note? (optional)') || null })}>
            Mark as done
          </button>
        )}

        {/* raiser checks the work */}
        {isRaiser && t.status === 'completed' && (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-dark" disabled={busy}
              onClick={() => call('verify_task', {
                p_task: t.id, p_note: prompt('Any comment? (optional)') || null },
                'Task closed')}>
              Accept the work
            </button>
            <button className="btn-bad" disabled={busy}
              onClick={() => {
                const why = prompt('What is not acceptable?')
                if (why?.trim()) call('reissue_task', { p_task: t.id, p_note: why })
              }}>
              Not OK — reissue
            </button>
          </div>
        )}

        {isRaiser && !['verified', 'cancelled'].includes(t.status) && (
          <button className="btn-ghost w-full" disabled={busy}
            onClick={() => {
              const why = prompt('Why cancel this task?')
              if (why?.trim()) call('cancel_task', { p_task: t.id, p_note: why })
            }}>
            Cancel task
          </button>
        )}
      </div>

      {/* history */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold">History</h2>
        <ol className="space-y-2.5">
          {events.map(e => (
            <li key={e.id} className="flex gap-3 text-[13px]">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
              <span className="flex-1">
                <span className="font-semibold capitalize">{e.action.replace(/_/g,' ')}</span>
                {e.note && <span className="text-slate2"> — {e.note}</span>}
                <span className="block text-[11px] text-slate2">
                  {e.actor_name || 'system'} · {dtTime(e.created_at)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <Link to="/tasks" className="block text-center text-sm text-gold underline">
        Back to tasks
      </Link>
    </div>
  )
}

function Cell({ label, value, warn }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className={'text-[13px] font-bold ' + (warn ? 'text-bad' : '')}>{value}</div>
    </div>
  )
}
