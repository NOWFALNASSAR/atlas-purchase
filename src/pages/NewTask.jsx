import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useMe } from '../App'
import Picker from '../components/Picker'
import TaskMedia from '../components/TaskMedia'

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
    priority: 'normal', due_date: '', assigned_to: null
  })
  const [points, setPoints] = useState([''])

  useEffect(() => {
    db.from('departments').select('id,name,code,kind,shop_id')
      .eq('active', true).order('sort_order')
      .then(({ data }) => setDepts(data || []))

    db.from('department_members')
      .select('department_id, departments(id,name,code,kind)')
      .eq('profile_id', me.id).eq('active', true)
      .then(({ data }) => {
        const list = (data || []).map(d => d.departments).filter(Boolean)
        setMine(list)
        if (list.length === 1) setF(v => ({ ...v, from_dept: list[0].id }))
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

    setBusy(true)

    const shopId = depts.find(d => d.id === f.to_dept)?.shop_id || null

    const { data, error } = await db.from('tasks').insert({
      from_dept: f.from_dept, to_dept: f.to_dept,
      title: f.title.trim(), details: f.details || null,
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

      <div className="card space-y-4 p-4">
        {mine.length > 1 ? (
          <Picker label="From" placeholder="Which department or showroom is asking?"
            options={mine.map(label)}
            value={f.from_dept} onChange={id => setF(v => ({ ...v, from_dept: id }))} />
        ) : mine.length === 1 ? (
          <div>
            <label>From</label>
            <div className="rounded-md border border-line bg-paper px-3 py-2 text-[15px]">
              {mine[0].name}
            </div>
          </div>
        ) : (
          <p className="text-sm text-bad">
            You are not in a department or showroom. An admin needs to add you first
            under Masters → Users.
          </p>
        )}

        <div>
          <Picker label="Answerable department" placeholder="Who is responsible for this?"
            options={others.map(label)}
            value={f.to_dept}
            onChange={id => setF(v => ({
              ...v, to_dept: id, assigned_to: null,
              support: v.support.filter(x => x !== id)
            }))} />
          <p className="mt-1 text-2xs text-slate2">
            One department only. They accept it, they finish it, they answer for it.
          </p>
        </div>

        {people.length > 0 && (
          <Picker label="Person (optional)" placeholder="Anyone in that department"
            options={people.map(p => ({ id: p.id, label: p.name, sub: p.post }))}
            value={f.assigned_to} onChange={id => setF(v => ({ ...v, assigned_to: id }))}
            allowEmpty />
        )}

        {/* supporting departments */}
        {f.to_dept && (
          <div>
            <label>Also involved (optional)</label>
            <p className="mb-2 text-2xs text-slate2">
              They see the task and can add notes, but the answerable department above
              is the one on the hook.
            </p>
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
          </div>
        )}

        <div>
          <label>What needs doing *</label>
          <input value={f.title} maxLength={140}
            onChange={e => setF(v => ({ ...v, title: e.target.value }))}
            placeholder="Short and specific" />
        </div>

        <div>
          <label>Details</label>
          <textarea rows={4} value={f.details}
            onChange={e => setF(v => ({ ...v, details: e.target.value }))}
            placeholder="Anything the other department needs to know" />
        </div>

        {/* sub-points */}
        <div>
          <label>Sub-points (optional)</label>
          <p className="mb-2 text-2xs text-slate2">
            Break the job into steps they tick off. A ticked list is how you know the
            work was done, not just marked done.
          </p>
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
            <input type="date" value={f.due_date}
              onChange={e => setF(v => ({ ...v, due_date: e.target.value }))} />
          </div>
        </div>

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
