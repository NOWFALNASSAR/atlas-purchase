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
  const [shops, setShops] = useState([])
  const [created, setCreated] = useState(null)
  const [f, setF] = useState({
    from_dept: '', to_dept: '', title: '', details: '',
    priority: 'normal', due_date: '', assigned_to: null, shop_id: null
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    db.from('departments').select('*').eq('active', true).order('sort_order')
      .then(({ data }) => setDepts(data || []))
    db.from('department_members')
      .select('department_id, departments(id,name,code)')
      .eq('profile_id', me.id).eq('active', true)
      .then(({ data }) => {
        const list = (data || []).map(d => d.departments).filter(Boolean)
        setMine(list)
        if (list.length === 1) setF(v => ({ ...v, from_dept: list[0].id }))
      })
    db.from('shops').select('id,code,name').eq('active', true).order('code')
      .then(({ data }) => setShops(data || []))
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

  async function create() {
    if (!f.from_dept) return alert('Which department is raising this?')
    if (!f.to_dept) return alert('Which department is it for?')
    if (f.from_dept === f.to_dept) return alert('Pick a different department to send it to')
    if (!f.title.trim()) return alert('Give the task a title')

    setBusy(true)
    const { data, error } = await db.from('tasks').insert({
      from_dept: f.from_dept, to_dept: f.to_dept,
      title: f.title.trim(), details: f.details || null,
      priority: f.priority, due_date: f.due_date || null,
      assigned_to: f.assigned_to, shop_id: f.shop_id,
      raised_by: me.id
    }).select().single()
    setBusy(false)
    if (error) return alert(error.message)
    setCreated(data)
  }

  if (created) {
    return (
      <div className="page page-sm space-y-4">
        <div className="card p-4">
          <div className="text-sm font-bold">Task raised</div>
          <div className="font-mono text-[12px] text-slate2">{created.task_no}</div>
          <p className="mt-2 text-[13px] text-slate2">
            Add photos or a voice note if it helps explain the job. MD Office can
            see this task automatically.
          </p>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-sm font-bold">Photos and voice</h2>
          <TaskMedia taskId={created.id} editable />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-dark" onClick={() => nav('/tasks/' + created.id)}>
            Open the task
          </button>
          <button className="btn-ghost" onClick={() => { setCreated(null);
            setF(v => ({ ...v, title: '', details: '', due_date: '', assigned_to: null })) }}>
            Raise another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page page-sm space-y-4">
      <div>
        <h1 className="text-xl font-bold">Raise a task</h1>
        <p className="text-sm text-slate2">
          Ask another department to do something. They set their own dates.
        </p>
      </div>

      <div className="card space-y-4 p-4">
        {mine.length > 1 ? (
          <Picker label="From department" placeholder="Which department is asking?"
            options={mine.map(d => ({ id: d.id, label: d.name, sub: d.code }))}
            value={f.from_dept} onChange={id => setF(v => ({ ...v, from_dept: id }))} />
        ) : mine.length === 1 ? (
          <div>
            <label>From department</label>
            <div className="rounded-md border border-line bg-paper px-3 py-2 text-[15px]">
              {mine[0].name}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-bad">
            You are not in a department. An admin needs to add you first.
          </p>
        )}

        <Picker label="To department" placeholder="Who should do this?"
          options={depts.filter(d => d.id !== f.from_dept)
            .map(d => ({ id: d.id, label: d.name, sub: d.code }))}
          value={f.to_dept} onChange={id => setF(v => ({ ...v, to_dept: id, assigned_to: null }))} />

        {people.length > 0 && (
          <Picker label="Person (optional)" placeholder="Anyone in that department"
            options={people.map(p => ({ id: p.id, label: p.name, sub: p.post }))}
            value={f.assigned_to} onChange={id => setF(v => ({ ...v, assigned_to: id }))}
            allowEmpty />
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

        <Picker label="Shop (optional)" placeholder="If it concerns one showroom"
          options={shops.map(s => ({ id: s.id, label: s.name, sub: s.code }))}
          value={f.shop_id} onChange={id => setF(v => ({ ...v, shop_id: id }))} allowEmpty />

        <button className="btn-dark w-full" onClick={create} disabled={busy || !mine.length}>
          {busy ? 'Raising' : 'Raise task'}
        </button>
        <p className="text-center text-[11px] text-slate2">
          Photos and voice notes come next, once the task has a number.
        </p>
      </div>
    </div>
  )
}
