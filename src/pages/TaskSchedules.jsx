import { useEffect, useState } from 'react'
import { db, dt } from '../lib/db'
import Picker from '../components/Picker'

/* ==================================================================
   RECURRING TASKS

   A schedule is a template. Every time it falls due the system raises
   an ordinary task from it — same workflow, same reports, same
   performance figures. The only difference is that nobody had to
   remember.
   ================================================================== */

const BLANK = {
  name: '', title: '', details: '',
  from_dept: '', to_dept: '', priority: 'normal',
  frequency: 'monthly', day_of_month: 5, every_days: 10,
  due_in_days: 3, lead_days: 2, scope: 'single', active: true
}

export default function TaskSchedules() {
  const [rows, setRows] = useState([])
  const [depts, setDepts] = useState([])
  const [edit, setEdit] = useState(null)
  const [points, setPoints] = useState([''])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showSetup, setShowSetup] = useState(false)

  useEffect(() => { boot() }, [])

  async function boot() {
    /* Generate anything due right now. If pg_cron is set up this finds
       nothing to do; if it is not, opening this page keeps things moving. */
    const { data } = await db.rpc('run_task_schedules')
    if (typeof data === 'number' && data > 0) setRan(data)
    await load()
  }

  async function load() {
    setLoading(true)
    const [s, d] = await Promise.all([
      db.from('task_schedules').select('*').order('name'),
      db.from('departments').select('id,name,code,kind').eq('active', true).order('sort_order')
    ])
    setRows(s.data || [])
    setDepts(d.data || [])
    setLoading(false)
  }

  async function open(row) {
    if (!row) { setEdit({ ...BLANK }); setPoints(['']); return }
    const { data } = await db.from('task_schedule_checklist')
      .select('*').eq('schedule_id', row.id).order('sort_order')
    setEdit({ ...row })
    setPoints((data || []).length ? data.map(p => p.label) : [''])
  }

  async function save() {
    const e = edit
    if (!e.name.trim())  return alert('Give the schedule a name')
    if (!e.title.trim()) return alert('Give the task a title')
    if (!e.from_dept)    return alert('Who is asking for this?')
    if (!e.to_dept)      return alert('Which department answers for it?')

    const body = {
      name: e.name.trim(), title: e.title.trim(), details: e.details || null,
      from_dept: e.from_dept, to_dept: e.to_dept, priority: e.priority,
      frequency: e.frequency,
      day_of_month: e.frequency === 'monthly' ? Number(e.day_of_month) : null,
      every_days:   e.frequency === 'interval' ? Number(e.every_days) : null,
      due_in_days: Number(e.due_in_days) || 0,
      lead_days: Number(e.lead_days) || 0,
      scope: e.scope, active: e.active
    }

    setBusy(true)
    const res = e.id
      ? await db.from('task_schedules').update(body).eq('id', e.id).select().single()
      : await db.from('task_schedules').insert(body).select().single()

    if (res.error) { setBusy(false); return alert(res.error.message) }

    const id = res.data.id
    await db.from('task_schedule_checklist').delete().eq('schedule_id', id)
    const list = points.map(p => p.trim()).filter(Boolean)
    if (list.length) {
      await db.from('task_schedule_checklist')
        .insert(list.map((label, i) => ({ schedule_id: id, sort_order: i + 1, label })))
    }

    setBusy(false); setEdit(null); load()
  }

  async function remove() {
    if (!confirm('Delete this schedule? Tasks it already raised are kept.')) return
    setBusy(true)
    const { error } = await db.from('task_schedules').delete().eq('id', edit.id)
    setBusy(false)
    if (error) return alert(error.message)
    setEdit(null); load()
  }

  async function runNow() {
    setBusy(true)
    const { data, error } = await db.rpc('run_task_schedules')
    setBusy(false)
    if (error) return alert(error.message)
    alert(data > 0 ? `${data} task${data > 1 ? 's' : ''} raised.` : 'Nothing was due.')
    load()
  }

  const deptName = id => depts.find(d => d.id === id)?.name || '—'
  const when = r => r.frequency === 'monthly'
    ? `Day ${r.day_of_month} of every month`
    : `Every ${r.every_days} days`

  return (
    <div className="page page-lg space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Recurring tasks</h1>
          <p className="text-sm text-slate2">
            Jobs that come round on their own — the monthly P&amp;L, vehicle checks,
            stock counts. Nobody has to remember them.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={runNow} disabled={busy}>Run now</button>
          <button className="btn-dark" onClick={() => open(null)}>New schedule</button>
        </div>
      </div>

      {ran > 0 && (
        <div className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">
          {ran} task{ran > 1 ? 's were' : ' was'} due and has been raised.
        </div>
      )}

      {loading ? (
        <div className="card h-40 animate-pulse bg-line2" />
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="mb-1.5 text-base font-semibold">No schedules yet</div>
          <p className="text-sm text-slate2">
            Add one for anything that happens on the same day every month, or every
            few days.
          </p>
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map(r => (
            <li key={r.id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper"
                onClick={() => open(r)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {r.name}
                    {!r.active && <span className="ml-2 tag bg-line text-slate2">off</span>}
                    {r.scope === 'each_showroom' && (
                      <span className="ml-2 tag bg-ink/10 text-ink">all showrooms</span>
                    )}
                  </div>
                  <div className="text-xs text-slate2">
                    {when(r)} · {deptName(r.to_dept)}
                    {r.next_run && ` · next ${dt(r.next_run)}`}
                  </div>
                </div>
                <span className="text-xs text-slate2">Edit</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* A block of SQL is not something the person running this screen
          every week needs to read. Tucked away, one line, opened once. */}
      <div className="text-center">
        <button className="text-xs font-medium text-slate2 hover:text-ink"
          onClick={() => setShowSetup(v => !v)}>
          {showSetup ? 'Hide' : 'How to make these run without opening this page'}
        </button>
      </div>

      {showSetup && (
        <div className="card p-4 text-xs text-slate2">
          <p>
            Opening this page already raises anything due. To have it happen at 6am
            on its own, run these two lines once in Supabase → SQL Editor. You only
            ever do this once.
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-paper p-2 text-2xs">
{`create extension if not exists pg_cron;
select cron.schedule('atlas-task-schedules', '30 0 * * *',
                     $$select run_task_schedules()$$);`}
          </pre>
          <p className="mt-2">00:30 UTC is 6:00am India time.</p>
        </div>
      )}

      {edit && (
        <Sheet title={edit.id ? edit.name : 'New schedule'} onClose={() => setEdit(null)}>
          <div className="space-y-4">
            <div>
              <label>Schedule name *</label>
              <input value={edit.name} placeholder="Monthly P&L"
                onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} />
              <p className="mt-1 text-2xs text-slate2">Only you see this. It is the label on this list.</p>
            </div>

            <div>
              <label>Task title *</label>
              <input value={edit.title} placeholder="Profit and loss statement"
                onChange={e => setEdit(v => ({ ...v, title: e.target.value }))} />
              <p className="mt-1 text-2xs text-slate2">This is what the department sees.</p>
            </div>

            <div>
              <label>Details</label>
              <textarea rows={3} value={edit.details || ''}
                onChange={e => setEdit(v => ({ ...v, details: e.target.value }))} />
            </div>

            <Picker label="Raised by" placeholder="Which department is asking"
              options={depts.map(d => ({ id: d.id, label: d.name, sub: d.code }))}
              value={edit.from_dept} onChange={id => setEdit(v => ({ ...v, from_dept: id }))} />

            <div>
              <label>Applies to</label>
              <select value={edit.scope}
                onChange={e => setEdit(v => ({ ...v, scope: e.target.value }))}>
                <option value="single">One department</option>
                <option value="each_showroom">Every showroom — one task each</option>
              </select>
            </div>

            {edit.scope === 'single' ? (
              <Picker label="Answerable department *" placeholder="Who does it"
                options={depts.map(d => ({
                  id: d.id, label: d.name,
                  sub: d.kind === 'showroom' ? 'Showroom' : d.code
                }))}
                value={edit.to_dept} onChange={id => setEdit(v => ({ ...v, to_dept: id }))} />
            ) : (
              <>
                <Picker label="Department that owns the check *" placeholder="Who owns it"
                  options={depts.filter(d => d.kind !== 'showroom')
                    .map(d => ({ id: d.id, label: d.name, sub: d.code }))}
                  value={edit.to_dept} onChange={id => setEdit(v => ({ ...v, to_dept: id }))} />
                <p className="-mt-2 text-2xs text-slate2">
                  Ten separate tasks are raised, one per showroom, each answerable by
                  that showroom.
                </p>
              </>
            )}

            <div>
              <label>How often</label>
              <select value={edit.frequency}
                onChange={e => setEdit(v => ({ ...v, frequency: e.target.value }))}>
                <option value="monthly">On a day of every month</option>
                <option value="interval">Every so many days</option>
              </select>
            </div>

            {edit.frequency === 'monthly' ? (
              <div>
                <label>Day of the month</label>
                <input type="number" min={1} max={28} value={edit.day_of_month || ''}
                  onChange={e => setEdit(v => ({ ...v, day_of_month: e.target.value }))} />
                <p className="mt-1 text-2xs text-slate2">
                  1 to 28 only, so it never skips February.
                </p>
              </div>
            ) : (
              <div>
                <label>Every how many days</label>
                <input type="number" min={1} max={365} value={edit.every_days || ''}
                  onChange={e => setEdit(v => ({ ...v, every_days: e.target.value }))} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Raise it this early</label>
                <input type="number" min={0} max={30} value={edit.lead_days}
                  onChange={e => setEdit(v => ({ ...v, lead_days: e.target.value }))} />
                <p className="mt-1 text-2xs text-slate2">Days of warning.</p>
              </div>
              <div>
                <label>Days to finish</label>
                <input type="number" min={0} max={60} value={edit.due_in_days}
                  onChange={e => setEdit(v => ({ ...v, due_in_days: e.target.value }))} />
                <p className="mt-1 text-2xs text-slate2">Sets the due date.</p>
              </div>
            </div>

            <div>
              <label>Priority</label>
              <select value={edit.priority}
                onChange={e => setEdit(v => ({ ...v, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label>Sub-points</label>
              <p className="mb-2 text-2xs text-slate2">
                Copied onto every task this schedule raises.
              </p>
              <div className="space-y-2">
                {points.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="grid w-6 shrink-0 place-items-center text-xs text-slate2">
                      {i + 1}
                    </span>
                    <input value={p} placeholder="One step"
                      onChange={e => setPoints(x => x.map((y, j) => (j === i ? e.target.value : y)))} />
                    <button type="button" className="btn-quiet shrink-0" aria-label="Remove"
                      onClick={() => setPoints(x => (x.length === 1 ? [''] : x.filter((_, j) => j !== i)))}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-ghost btn-sm mt-2"
                onClick={() => setPoints(p => [...p, ''])}>
                Add a step
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="!w-auto" checked={edit.active}
                onChange={e => setEdit(v => ({ ...v, active: e.target.checked }))} />
              <span>Active — keep raising this</span>
            </label>

            {edit.next_run && (
              <p className="rounded-md bg-paper px-3 py-2 text-xs text-slate2">
                Next due {dt(edit.next_run)}
                {edit.last_run && ` · last raised ${dt(edit.last_run)}`}
              </p>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button className="btn-dark flex-1" disabled={busy} onClick={save}>
              {busy ? 'Saving' : 'Save schedule'}
            </button>
            {edit.id && (
              <button className="btn-ghost text-bad" disabled={busy} onClick={remove}>
                Delete
              </button>
            )}
          </div>
        </Sheet>
      )}
    </div>
  )
}

function Sheet({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
      onClick={onClose}>
      <div className="safe-b max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-pop md:max-w-xl md:rounded-xl lg:p-6"
        onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-sm text-slate2">Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}
