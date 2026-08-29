import { useEffect, useState } from 'react'
import { db, roleLabel, inr } from '../lib/db'
import { Modal } from './Suppliers'

const ROLES = ['executive', 'manager', 'hod', 'accounts', 'admin']

export default function Users() {
  const [rows, setRows] = useState([])
  const [entities, setEntities] = useState([])
  const [edit, setEdit] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const [{ data: p }, { data: e }] = await Promise.all([
      db.from('profiles').select('*').order('full_name'),
      db.from('entities').select('*').order('code')
    ])
    setRows(p || []); setEntities(e || [])
  }

  async function save() {
    const { error } = await db.from('profiles').update({
      full_name: edit.full_name,
      emp_code: edit.emp_code,
      phone: edit.phone,
      role: edit.role,
      entity_ids: edit.entity_ids || [],
      approval_limit: Number(edit.approval_limit) || 0,
      active: edit.active
    }).eq('id', edit.id)
    if (error) return alert(error.message)
    setEdit(null); load()
  }

  function toggleEntity(id) {
    setEdit(u => {
      const cur = u.entity_ids || []
      return { ...u, entity_ids: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Users</h1>
        <p className="text-sm text-slate2">
          People sign up themselves on the login screen. You set their role and access here.
        </p>
      </div>

      <ul className="card divide-y divide-line">
        {rows.map(u => (
          <li key={u.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper"
              onClick={() => setEdit(u)}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {u.full_name || '(no name)'}
                  {!u.active && <span className="ml-2 tag bg-bad/10 text-bad">off</span>}
                </div>
                <div className="text-[11px] text-slate2">
                  {roleLabel(u.role)}
                  {u.approval_limit > 0 && ' · up to ' + inr(u.approval_limit)}
                  {u.entity_ids?.length ? ` · ${u.entity_ids.length} entity` : ' · all entities'}
                </div>
              </div>
              <span className="text-xs text-slate2">Edit</span>
            </button>
          </li>
        ))}
      </ul>

      {edit && (
        <Modal title="Edit user" onClose={() => setEdit(null)}>
          <div className="space-y-3">
            <div><label>Full name</label>
              <input value={edit.full_name || ''} onChange={e => setEdit(u => ({ ...u, full_name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label>Employee code</label>
                <input value={edit.emp_code || ''} onChange={e => setEdit(u => ({ ...u, emp_code: e.target.value }))} /></div>
              <div><label>Phone</label>
                <input value={edit.phone || ''} onChange={e => setEdit(u => ({ ...u, phone: e.target.value }))} /></div>
            </div>
            <div><label>Role</label>
              <select value={edit.role} onChange={e => setEdit(u => ({ ...u, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select></div>
            <div><label>Approval limit ₹ (0 = no limit)</label>
              <input type="number" value={edit.approval_limit || 0}
                onChange={e => setEdit(u => ({ ...u, approval_limit: e.target.value }))} /></div>
            <div>
              <label>Entity access (none ticked = all)</label>
              <div className="space-y-1.5">
                {entities.map(en => (
                  <label key={en.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="!w-auto"
                      checked={(edit.entity_ids || []).includes(en.id)}
                      onChange={() => toggleEntity(en.id)} />
                    <span className="normal-case tracking-normal">{en.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="!w-auto" checked={edit.active}
                onChange={e => setEdit(u => ({ ...u, active: e.target.checked }))} />
              <span className="normal-case tracking-normal">Active — can sign in</span>
            </label>
          </div>
          <button className="btn-dark mt-4 w-full" onClick={save}>Save user</button>
        </Modal>
      )}
    </div>
  )
}
