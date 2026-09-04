import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useMe } from '../App'
import Picker from '../components/Picker'
import TaskMedia from '../components/TaskMedia'
import Field from '../components/Field'

export default function NewTask() {
  const me = useMe()
  const nav = useNavigate()

  const [depts, setDepts] = useState([])
  const [mine, setMine] = useState([])
  const [people, setPeople] = useState([])
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)

  const [f, setF] = useState({
    from_dept: '', to_dept: '', support: [], title: '', details: '',
    priority: 'normal', due_date: '', assigned_to: null, task_type: 'general'
  })

  /* Most tasks are a sentence. A manpower request is a form — the
     position, the salary and the date. Asking for that in free text
     means it arrives incomplete and HR spends a week chasing it. */
  const [mrf, setMrf] = useState({
    position: '', for_department: '', headcount: 1, employment: 'full_time',
    salary_min: '', salary_max: '', salary_period: 'month',
    expected_by: '', qualification: '', experience: '', reason: '', replacing: ''
  })
  const [points, setPoints] = useState([''])

  useEffect(() => {
    db.from('departments').select('id,name,code,kind,shop_id')
      .eq('active', true).order('sort_order')
      .then(({ data }) => setDepts(data || []))

    db.from('department_members')
      .select('department_id, post, departments(id,name,code,kind,is_md_office)')
      .eq('profile_id', me.id).eq('active', true)
      .then(({ data }) => {
        /* Somebody in MD Office as well as their own department was
           getting MD Office as the sender, because the rows come back in
           whatever order the database feels like. Your own department is
           what you raise from; MD Office goes last and is only the
           default if it is the only one you are in. */
        const list = (data || [])
          .map(d => ({ ...d.departments, post: d.post }))
          .filter(Boolean)
          .sort((a, b) => (a.is_md_office ? 1 : 0) - (b.is_md_office ? 1 : 0))

        setMine(list)

        const remembered = localStorage.getItem('taskFromDept')
        const start = list.find(d => d.id === remembered) || list[0]
        if (start) setF(v => ({ ...v, from_dept: start.id }))
      })
  }, [])

  useEffect(() => {
    if (!f.to_dept) { setPeople([]); return }
    db.from('department_members')
      .select('profile_id, post, profiles(id,full_name)')
      .eq('department_id', f.to_dept).eq('active', true)
      .then(({ data }) => setPeople((data || []).map(d => ({
        id: d.profile_id, name: d.profiles?.full_name || '—', post: d.post
      }))))
  }, [f.to_dept])

  const label = d => ({ id: d.id, label: d.name, sub: d.kind === 'showroom' ? 'Showroom' : d.code })

  function toggleSupport(id) {
    setF(v => ({
      ...v,
      support: v.support.includes(id) ? v.support.filter(x => x !== id) : [...v.support, id]
    }))
  }

  const setPoint = (i, val) => setPoints(p => p.map((x, j) => (j === i ? val : x)))
  const addPoint = () => setPoints(p => [...p, ''])
  const dropPoint = i => setPoints(p => (p.length === 1 ? [''] : p.filter((_, j) => j !== i)))

  async function create() {
    if (!f.from_dept) return alert('Which department is raising this?')
    if (!f.to_dept) return alert('Which department is answerable?')
    if (f.from_dept === f.to_dept) return alert('Pick a different department to send it to')
    if (!f.title.trim()) return alert('Give the task a title')
    if (f.task_type === 'mrf' && !mrf.position.trim())
      return alert('Which position are you asking for?')

    setBusy(true)

    const shopId = depts.find(d => d.id === f.to_dept)?.shop_id || null

    const { data, error } = await db.from('tasks').insert({
      from_dept: f.from_dept, to_dept: f.to_dept,
      title: f.title.trim(), details: f.details || null, task_type: f.task_type,
      priority: f.priority, due_date: f.due_date || null,
      assigned_to: f.assigned_to, shop_id: shopId,
      raised_by: me.id
    }).select().single()

    if (error) { setBusy(false); return alert(error.message) }

    const support = f.support.filter(id => id !== f.to_dept && id !== f.from_dept)
    if (support.length) {
      await db.from('task_departments')
        .insert(support.map(department_id => ({ task_id: data.id, department_id })))
    }

    if (f.task_type === 'mrf') {
      await db.from('task_mrf').insert({
        task_id: data.id,
        position: mrf.position.trim(),
        for_department: mrf.for_department || f.from_dept,
        headcount: Number(mrf.headcount) || 1,
        employment: mrf.employment,
        salary_min: mrf.salary_min ? Number(mrf.salary_min) : null,
        salary_max: mrf.salary_max ? Number(mrf.salary_max) : null,
        salary_period: mrf.salary_period,
        expected_by: mrf.expected_by || null,
        qualification: mrf.qualification || null,
        experience: mrf.experience || null,
        reason: mrf.reason || null,
        replacing: mrf.replacing || null
      })
    }

    const list = points.map(p => p.trim()).filter(Boolean)
    if (list.length) {
      await db.from('task_checklist')
        .insert(list.map((labelText, i) => ({
          task_id: data.id, sort_order: i + 1, label: labelText
        })))
    }

    setBusy(false)
    setCreated(data)
  }

  /* ---------------- after it is raised ---------------- */

  if (created) {
    return (
      <div className="page page-sm space-y-4">
        <div className="card p-4">
          <div className="text-sm font-semibold">Task raised</div>
          <div className="font-mono text-xs text-slate2">{created.task_no}</div>
          <p className="mt-2 text-sm text-slate2">
            Everyone in the receiving department has been notified. Add photos or a
            voice note if it helps explain the job.
          </p>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Photos and voice</h2>
          <TaskMedia taskId={created.id} editable />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-dark" onClick={() => nav('/tasks/' + created.id)}>
            Open the task
          </button>
          <button className="btn-ghost" onClick={() => {
            setCreated(null)
            setF(v => ({ ...v, title: '', details: '', due_date: '', assigned_to: null, support: [] }))
            setPoints([''])
          }}>
            Raise another
          </button>
        </div>
      </div>
    )
  }

  /* ---------------- the form ---------------- */

  const others = depts.filter(d => d.id !== f.from_dept)
  const supportable = depts.filter(d => d.id !== f.from_dept && d.id !== f.to_dept)

  return (
    <div className="page page-sm space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Raise a task</h1>
        <p className="text-sm text-slate2">
          Ask a department or a showroom to do something. They set their own dates.
        </p>
      </div>

      <div className="space-y-3">
        <Field n="1" title="From" required done={!!f.from_dept}
          hint="Which department or showroom is asking">
        {mine.length > 1 ? (
          <Picker label="" placeholder="Which department or showroom is asking?"
            options={mine.map(label)}
            value={f.from_dept}
            onChange={id => {
              localStorage.setItem('taskFromDept', id)
              setF(v => ({ ...v, from_dept: id, to_dept: v.to_dept === id ? '' : v.to_dept }))
            }} />
        ) : mine.length === 1 ? (
          <div>
            <div className="rounded-md border border-line bg-paper px-3 py-2 text-[15px]">
              {mine[0].name}
            </div>
            <p className="mt-1 text-2xs text-slate2">
              Raised as {mine[0].name}, by you. It will show in your raised list.
            </p>
          </div>
        ) : (
          <div className="rounded-md bg-bad/10 px-3 py-2.5 text-sm text-bad">
            <div className="font-semibold">You are not in a department yet</div>
            <p className="mt-0.5">
              Your role is set, but a role and a department are separate things. Ask
              your admin to open Masters → Users, pick your name, and tick a
              department on the Departments tab.
            </p>
          </div>
        )}
        </Field>

        <Field n="2" title="Answerable department" required done={!!f.to_dept}
          hint="One department only. They accept it, they finish it, they answer for it.">
          <Picker label="" placeholder="Who is responsible for this?"
            options={others.map(label)}
            value={f.to_dept}
            onChange={id => setF(v => ({
              ...v, to_dept: id, assigned_to: null,
              support: v.support.filter(x => x !== id)
            }))} />
        </Field>

        {people.length > 0 && (
          <Field n="3" title="Assign to" done={!!f.assigned_to}
            hint="Optional — leave blank and anyone in that department can pick it up">
            <Picker label="" placeholder="Anyone in that department"
              options={people.map(p => ({ id: p.id, label: p.name, sub: p.post }))}
              value={f.assigned_to} onChange={id => setF(v => ({ ...v, assigned_to: id }))}
              allowEmpty />
          </Field>
        )}

        {/* supporting departments */}
        {f.to_dept && (
          <Field n="4" title="Also involved" done={f.support.length > 0}
            hint="They see it and can add notes. The answerable department above is still the one on the hook.">
            <div className="max-h-52 overflow-y-auto rounded-md border border-line">
              {supportable.map(d => (
                <label key={d.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 last:border-0 hover:bg-paper">
                  <input type="checkbox" className="!w-auto"
                    checked={f.support.includes(d.id)} onChange={() => toggleSupport(d.id)} />
                  <span className="text-sm">{d.name}</span>
                  {d.kind === 'showroom' && (
                    <span className="tag bg-line text-slate2">showroom</span>
                  )}
                </label>
              ))}
            </div>
            {f.support.length > 0 && (
              <p className="mt-1 text-2xs text-slate2">
                {f.support.length} department{f.support.length > 1 ? 's' : ''} supporting.
              </p>
            )}
          </Field>
        )}

        <Field n="5" title="What kind of task" done={f.task_type !== 'general'}
          hint="Picking MRF opens the manpower form">
          <select value={f.task_type}
            onChange={e => {
              const v = e.target.value
              setF(x => ({
                ...x, task_type: v,
                title: v === 'mrf' && !x.title ? 'Manpower request' : x.title
              }))
            }}>
            <option value="general">General</option>
            <option value="mrf">MRF — manpower request</option>
            <option value="maintenance">Maintenance</option>
            <option value="report">Report</option>
            <option value="audit">Audit</option>
            <option value="complaint">Complaint</option>
          </select>
          {f.task_type === 'mrf' && (
            <p className="mt-1 text-2xs text-slate2">
              Send this to HR. The form below goes with it, so nobody has to ask
              what the salary or the date is.
            </p>
          )}
        </Field>

        {f.task_type === 'mrf' && (
          <div className="rounded-lg border border-gold/40 bg-gold2/50 p-3.5">
            <h3 className="mb-3 text-sm font-semibold text-gold">Manpower request</h3>
            <div className="space-y-3">
              <div>
                <label>Position *</label>
                <input value={mrf.position} placeholder="Sales executive"
                  onChange={e => setMrf(v => ({ ...v, position: e.target.value }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>How many</label>
                  <input type="number" min={1} max={99} value={mrf.headcount}
                    onChange={e => setMrf(v => ({ ...v, headcount: e.target.value }))} />
                </div>
                <div>
                  <label>Type</label>
                  <select value={mrf.employment}
                    onChange={e => setMrf(v => ({ ...v, employment: e.target.value }))}>
                    <option value="full_time">Full time</option>
                    <option value="part_time">Part time</option>
                    <option value="contract">Contract</option>
                    <option value="trainee">Trainee</option>
                  </select>
                </div>
              </div>

              <Picker label="For which department or showroom"
                placeholder="Where will they work"
                options={depts.map(label)}
                value={mrf.for_department}
                onChange={id => setMrf(v => ({ ...v, for_department: id }))} allowEmpty />

              <div>
                <label>Expected salary</label>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" inputMode="numeric" placeholder="From"
                    value={mrf.salary_min}
                    onChange={e => setMrf(v => ({ ...v, salary_min: e.target.value }))} />
                  <input type="number" inputMode="numeric" placeholder="To"
                    value={mrf.salary_max}
                    onChange={e => setMrf(v => ({ ...v, salary_max: e.target.value }))} />
                  <select value={mrf.salary_period}
                    onChange={e => setMrf(v => ({ ...v, salary_period: e.target.value }))}>
                    <option value="month">per month</option>
                    <option value="day">per day</option>
                    <option value="year">per year</option>
                  </select>
                </div>
              </div>

              <div>
                <label>Needed by</label>
                <input type="date" value={mrf.expected_by}
                  onChange={e => setMrf(v => ({ ...v, expected_by: e.target.value }))} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label>Qualification</label>
                  <input value={mrf.qualification} placeholder="Plus two and above"
                    onChange={e => setMrf(v => ({ ...v, qualification: e.target.value }))} />
                </div>
                <div>
                  <label>Experience</label>
                  <input value={mrf.experience} placeholder="2 years in retail"
                    onChange={e => setMrf(v => ({ ...v, experience: e.target.value }))} />
                </div>
              </div>

              <div>
                <label>Replacing someone?</label>
                <input value={mrf.replacing} placeholder="Name of who left, if any"
                  onChange={e => setMrf(v => ({ ...v, replacing: e.target.value }))} />
              </div>

              <div>
                <label>Why is this needed</label>
                <textarea rows={2} value={mrf.reason}
                  onChange={e => setMrf(v => ({ ...v, reason: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        <Field n="6" title="Task heading" required done={!!f.title.trim()}
          hint="Short and specific. This is what appears in every list.">
          <input value={f.title} maxLength={140}
            onChange={e => setF(v => ({ ...v, title: e.target.value }))}
            placeholder="Verify supplier outstanding for August" />
          <p className="mt-1 text-right text-2xs text-slate2">{f.title.length}/140</p>
        </Field>

        <Field n="7" title="Description" done={!!f.details}
          hint="Anything the other department needs in order to start">
          <textarea rows={4} value={f.details}
            onChange={e => setF(v => ({ ...v, details: e.target.value }))} />
        </Field>

        {/* sub-points */}
        <Field n="8" title="Sub-points" done={points.some(x => x.trim())}
          hint="Break the job into steps they tick off. A ticked list is how you know work was done, not just marked done.">
          <div className="space-y-2">
            {points.map((p, i) => (
              <div key={i} className="flex gap-2">
                <span className="grid w-6 shrink-0 place-items-center text-xs text-slate2">
                  {i + 1}
                </span>
                <input value={p} onChange={e => setPoint(i, e.target.value)}
                  placeholder="One step" />
                <button type="button" className="btn-quiet shrink-0"
                  onClick={() => dropPoint(i)} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn-ghost btn-sm mt-2" onClick={addPoint}>
            Add a step
          </button>
        </Field>

        <Field n="9" title="Priority and date" done={!!f.due_date}
          hint="The date is what overdue is measured against">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label>Priority</label>
              <select value={f.priority}
                onChange={e => setF(v => ({ ...v, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="normal">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Critical</option>
              </select>
            </div>
            <div>
              <label>Completion date</label>
              <input type="date" value={f.due_date}
                onChange={e => setF(v => ({ ...v, due_date: e.target.value }))} />
            </div>
          </div>
        </Field>

        <button className="btn-dark w-full" onClick={create} disabled={busy || !mine.length}>
          {busy ? 'Raising' : 'Raise task'}
        </button>
        <p className="text-center text-2xs text-slate2">
          Photos and voice notes come next, once the task has a number.
        </p>
      </div>
    </div>
  )
}
