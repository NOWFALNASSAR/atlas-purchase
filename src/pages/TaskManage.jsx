import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { db, dt } from '../lib/db'
import { useMe, useCan } from '../App'
import Picker from '../components/Picker'

/* ==================================================================
   MANAGE A TASK

   Everything that changes a task lives here and nowhere else.

   The task page itself is for reading and for adding notes. Mixing the
   two meant somebody raising a task saw approve and cancel buttons on
   the same screen as the thing they had just written, which invites
   the wrong tap on a phone.

   Editing, rescheduling, reassigning and cancelling belong to MD Office
   and admin. Everyone else works the task and writes notes.
   ================================================================== */

const SECTIONS = [
  ['edit',       'Edit details',   'Title, description, priority, who it is for'],
  ['reschedule', 'Reschedule',     'Move the promised start and finish'],
  ['reassign',   'Move it',        'Send it to a different department'],
  ['close',      'Close it',       'Accept the work, send it back, or cancel']
]

export default function TaskManage() {
  const { id } = useParams()
  const nav = useNavigate()
  const me = useMe()
  const can = useCan()

  const [t, setT] = useState(null)
  const [depts, setDepts] = useState([])
  const [people, setPeople] = useState([])
  const [allowed, setAllowed] = useState(null)
  const [open, setOpen] = useState('edit')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const [f, setF] = useState({})
  const [sched, setSched] = useState({ start: '', finish: '', reason: '' })
  const [move, setMove] = useState({ dept: '', note: '' })

  useEffect(() => { load() }, [id])

  async function load() {
    const [task, dp, ok] = await Promise.all([
      db.from('v_task_full').select('*').eq('id', id).maybeSingle(),
      db.from('departments').select('id,name,code,kind').eq('active', true).order('sort_order'),
      db.rpc('can_edit_task', { p_task: id })
    ])
    if (!task.data) { setAllowed(false); return }

    setT(task.data)
    setDepts(dp.data || [])
    setAllowed(ok.data === true)
    setF({
      title: task.data.title || '',
      details: task.data.details || '',
      priority: task.data.priority || 'normal',
      due_date: task.data.due_date || '',
      assigned_to: task.data.assigned_to || null,
      note: ''
    })
    setSched({
      start: task.data.planned_start || new Date().toISOString().slice(0, 10),
      finish: task.data.planned_finish || task.data.due_date || '',
      reason: ''
    })
    setMove({ dept: task.data.to_dept, note: '' })

    const pe = await db.from('department_members')
      .select('profile_id, post, profiles(full_name)')
      .eq('department_id', task.data.to_dept).eq('active', true)
    setPeople((pe.data || []).map(p => ({
      id: p.profile_id, label: p.profiles?.full_name || '—', sub: p.post
    })))
  }

  async function call(fn, args, done) {
    setBusy(true); setMsg(null)
    const { error } = await db.rpc(fn, args)
    setBusy(false)
    if (error) return setMsg({ bad: true, text: error.message })
    setMsg({ text: done })
    load()
  }

  if (allowed === null) {
    return <div className="py-16 text-center text-sm text-slate2">Loading</div>
  }

  if (!t || allowed === false) {
    return (
      <div className="page page-md py-16 text-center">
        <div className="mb-2 text-base font-semibold">Not yours to change</div>
        <p className="text-sm text-slate2">
          Changing a task — its dates, its department, closing it — belongs to MD
          Office and admin. You can still open the task and add a note explaining
          what needs to change.
        </p>
        <Link to={'/tasks/' + id} className="btn-ghost mt-4">Back to the task</Link>
      </div>
    )
  }

  const closed = ['verified', 'cancelled'].includes(t.status)

  return (
    <div className="page page-md space-y-4">
      <Link to={'/tasks/' + id} className="text-sm font-medium text-slate2">
        Back to the task
      </Link>

      <div className="card p-4">
        <div className="text-base font-semibold">{t.title}</div>
        <div className="mt-0.5 text-xs text-slate2">
          <span className="font-mono">{t.task_no}</span>
          {' · '}{t.from_dept_name} → {t.to_dept_name}
          {' · '}{t.status}
        </div>
        {closed && (
          <div className="mt-3 rounded-md bg-paper px-3 py-2 text-sm text-slate2">
            This task is closed. Nothing further can be changed.
          </div>
        )}
      </div>

      {msg && (
        <div className={'rounded-md px-3 py-2.5 text-sm ' +
          (msg.bad ? 'bg-bad/10 text-bad' : 'bg-good/10 text-good')}>
          {msg.text}
        </div>
      )}

      {!closed && SECTIONS.map(([key, title, hint]) => (
        <section key={key} className="card overflow-hidden">
          <button onClick={() => setOpen(o => (o === key ? null : key))}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper">
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-2xs text-slate2">{hint}</span>
            </span>
            <span className="text-xs text-slate2">{open === key ? 'Hide' : 'Open'}</span>
          </button>

          {open === key && (
            <div className="border-t border-line p-4">
              {key === 'edit' && (
                <div className="space-y-3">
                  <div>
                    <label>Title</label>
                    <input value={f.title}
                      onChange={e => setF(v => ({ ...v, title: e.target.value }))} />
                  </div>
                  <div>
                    <label>Details</label>
                    <textarea rows={4} value={f.details}
                      onChange={e => setF(v => ({ ...v, details: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label>Priority</label>
                      <select value={f.priority}
                        onChange={e => setF(v => ({ ...v, priority: e.target.value }))}>
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div>
                      <label>Needed by</label>
                      <input type="date" value={f.due_date || ''}
                        onChange={e => setF(v => ({ ...v, due_date: e.target.value }))} />
                    </div>
                  </div>
                  {people.length > 0 && (
                    <Picker label="Person" placeholder="Anyone in that department"
                      options={people} value={f.assigned_to}
                      onChange={x => setF(v => ({ ...v, assigned_to: x }))} allowEmpty />
                  )}
                  <div>
                    <label>Why are you changing it</label>
                    <input value={f.note} placeholder="Goes into the task history"
                      onChange={e => setF(v => ({ ...v, note: e.target.value }))} />
                  </div>
                  <button className="btn-dark w-full" disabled={busy}
                    onClick={() => call('edit_task', {
                      p_task: t.id, p_title: f.title, p_details: f.details,
                      p_priority: f.priority, p_due: f.due_date || null,
                      p_assigned: f.assigned_to, p_note: f.note || null
                    }, 'Saved. The change is in the history.')}>
                    Save changes
                  </button>
                </div>
              )}

              {key === 'reschedule' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate2">
                    Moving the finish date is the change worth recording, because it
                    is the one that quietly turns a late task into an on-time one.
                    The old date stays in the history.
                  </p>
                  {t.planned_finish && (
                    <div className="rounded-md bg-paper px-3 py-2 text-sm">
                      Currently promised: <strong>{dt(t.planned_finish)}</strong>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label>New start</label>
                      <input type="date" value={sched.start}
                        onChange={e => setSched(v => ({ ...v, start: e.target.value }))} />
                    </div>
                    <div>
                      <label>New finish</label>
                      <input type="date" value={sched.finish}
                        onChange={e => setSched(v => ({ ...v, finish: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label>Reason *</label>
                    <textarea rows={2} value={sched.reason}
                      onChange={e => setSched(v => ({ ...v, reason: e.target.value }))} />
                  </div>
                  <button className="btn-dark w-full" disabled={busy}
                    onClick={() => call('reschedule_task', {
                      p_task: t.id, p_start: sched.start,
                      p_finish: sched.finish, p_reason: sched.reason
                    }, 'Dates moved.')}>
                    Move the dates
                  </button>
                </div>
              )}

              {key === 'reassign' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate2">
                    The department you pick becomes answerable for it. They will be
                    asked to accept it and set their own dates again.
                  </p>
                  <Picker label="Department" placeholder="Who should do this"
                    options={depts.map(d => ({
                      id: d.id, label: d.name,
                      sub: d.kind === 'showroom' ? 'Showroom' : d.code
                    }))}
                    value={move.dept} onChange={x => setMove(v => ({ ...v, dept: x }))} />
                  <div>
                    <label>Note *</label>
                    <textarea rows={2} value={move.note} placeholder="Why it goes to them"
                      onChange={e => setMove(v => ({ ...v, note: e.target.value }))} />
                  </div>
                  <button className="btn-dark w-full" disabled={busy}
                    onClick={() => call('md_assign_task', {
                      p_task: t.id, p_dept: move.dept, p_note: move.note
                    }, 'Moved.')}>
                    Move to this department
                  </button>
                </div>
              )}

              {key === 'close' && (
                <div className="space-y-2.5">
                  {t.status === 'completed' && (
                    <>
                      <button className="btn-dark w-full" disabled={busy}
                        onClick={() => call('verify_task', {
                          p_task: t.id, p_note: prompt('Any comment? (optional)') || null
                        }, 'Task closed.')}>
                        Accept the work and close
                      </button>
                      <button className="btn-bad w-full" disabled={busy}
                        onClick={() => {
                          const why = prompt('What is not acceptable?')
                          if (why?.trim()) call('reissue_task', { p_task: t.id, p_note: why },
                            'Sent back.')
                        }}>
                        Send it back
                      </button>
                    </>
                  )}

                  {t.status !== 'completed' && (
                    <p className="rounded-md bg-paper px-3 py-2.5 text-sm text-slate2">
                      Accepting the work becomes available once {t.to_dept_name} marks
                      it done.
                    </p>
                  )}

                  {can('tasks.cancel') && (
                    <button className="btn-ghost w-full text-bad" disabled={busy}
                      onClick={() => {
                        const why = prompt('Why cancel this task?')
                        if (why?.trim()) call('cancel_task', { p_task: t.id, p_note: why },
                          'Cancelled.')
                      }}>
                      Cancel the task
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      ))}

      <div className="card p-4">
        <h2 className="mb-1 text-sm font-semibold">Everything here is recorded</h2>
        <p className="text-xs text-slate2">
          Each change writes a line into the task's history with your name, the time
          and what changed. A silent edit to a task somebody is being measured on is
          worse than no edit at all.
        </p>
      </div>
    </div>
  )
}
