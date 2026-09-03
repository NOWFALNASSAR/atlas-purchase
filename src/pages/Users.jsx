import { useEffect, useMemo, useState } from 'react'
import { db, roleLabel, inr } from '../lib/db'
import { Modal } from './Suppliers'
import {
  ROLES, loadRights, groupByModule, effectivePerms,
  toggleUserPerm, isOverride, overrideCount
} from '../lib/perms'
import { useMe } from '../App'

export default function Users() {
  const me = useMe()
  const [rows, setRows] = useState([])
  const [entities, setEntities] = useState([])
  const [permissions, setPermissions] = useState([])
  const [rolePerms, setRolePerms] = useState({})
  const [q, setQ] = useState('')
  const [showOff, setShowOff] = useState(true)
  const [edit, setEdit] = useState(null)
  const [tab, setTab] = useState('details')
  const [busy, setBusy] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: p }, { data: e }, rights] = await Promise.all([
      db.from('profiles').select('*').order('full_name'),
      db.from('entities').select('*').eq('active', true).order('code'),
      loadRights()
    ])
    setRows(p || [])
    setEntities(e || [])
    setPermissions(rights.permissions)
    setRolePerms(rights.rolePerms)
  }

  const allCodes = useMemo(() => permissions.map(p => p.code), [permissions])
  const groups = useMemo(() => groupByModule(permissions), [permissions])

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(u => {
      if (!showOff && !u.active) return false
      if (!t) return true
      return [u.full_name, u.emp_code, u.phone, roleLabel(u.role)]
        .some(v => (v || '').toLowerCase().includes(t))
    })
  }, [rows, q, showOff])

  function open(u) {
    setEdit({ ...u, perm_grant: u.perm_grant || [], perm_deny: u.perm_deny || [] })
    setTab('details')
  }

  async function save() {
    setBusy(true)
    const { error } = await db.from('profiles').update({
      full_name:      edit.full_name,
      emp_code:       edit.emp_code,
      phone:          edit.phone,
      role:           edit.role,
      entity_ids:     edit.entity_ids || [],
      approval_limit: Number(edit.approval_limit) || 0,
      perm_grant:     edit.role === 'admin' ? [] : (edit.perm_grant || []),
      perm_deny:      edit.role === 'admin' ? [] : (edit.perm_deny || []),
      active:         edit.active
    }).eq('id', edit.id)
    setBusy(false)
    if (error) return alert(error.message)
    setEdit(null)
    load()
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
          People sign up themselves on the login screen. You set their role, their
          rights and which entities they can see. Nobody can do anything until you do.
        </p>
      </div>

      <div className="flex gap-2">
        <input placeholder="Search name, code or phone"
          value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn-ghost whitespace-nowrap"
          onClick={() => setShowOff(s => !s)}>
          {showOff ? 'Hide off' : 'Show all'}
        </button>
      </div>

      <ul className="card divide-y divide-line">
        {visible.map(u => {
          const eff = effectivePerms(u, rolePerms, allCodes)
          const over = overrideCount(u)
          return (
            <li key={u.id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper"
                onClick={() => open(u)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {u.full_name || '(no name)'}
                    {u.id === me.id && <span className="ml-2 tag bg-line text-slate2">you</span>}
                    {!u.active && <span className="ml-2 tag bg-bad/10 text-bad">off</span>}
                  </div>
                  <div className="text-[11px] text-slate2">
                    {roleLabel(u.role)}
                    {u.approval_limit > 0 && ' · up to ' + inr(u.approval_limit)}
                    {u.role === 'admin'
                      ? ' · full rights'
                      : ` · ${eff.size} rights`}
                    {over > 0 && ` · ${over} custom`}
                    {u.entity_ids?.length ? ` · ${u.entity_ids.length} entity` : ' · all entities'}
                  </div>
                </div>
                <span className="text-xs text-slate2">Edit</span>
              </button>
            </li>
          )
        })}
        {!visible.length && (
          <li className="px-4 py-6 text-center text-sm text-slate2">No user matches that.</li>
        )}
      </ul>

      {edit && (
        <Modal title={edit.full_name || 'User'} onClose={() => setEdit(null)}>
          <div className="mb-4 flex gap-1 rounded-md bg-paper p-1">
            {[['details', 'Details'], ['rights', 'Rights']].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={'flex-1 rounded px-3 py-1.5 text-sm font-semibold ' +
                  (tab === k ? 'bg-white text-ink shadow-sm' : 'text-slate2')}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'details' ? (
            <Details edit={edit} setEdit={setEdit} entities={entities}
              toggleEntity={toggleEntity} isSelf={edit.id === me.id} />
          ) : (
            <Rights edit={edit} setEdit={setEdit} groups={groups}
              rolePerms={rolePerms} allCodes={allCodes} />
          )}

          <button className="btn-dark mt-4 w-full" disabled={busy} onClick={save}>
            {busy ? 'Saving' : 'Save user'}
          </button>
        </Modal>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Details({ edit, setEdit, entities, toggleEntity, isSelf }) {
  const set = (k, v) => setEdit(u => ({ ...u, [k]: v }))

  return (
    <div className="space-y-3">
      <div>
        <label>Full name</label>
        <input value={edit.full_name || ''} onChange={e => set('full_name', e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label>Employee code</label>
          <input value={edit.emp_code || ''} onChange={e => set('emp_code', e.target.value)} />
        </div>
        <div>
          <label>Phone</label>
          <input value={edit.phone || ''} onChange={e => set('phone', e.target.value)} />
        </div>
      </div>

      <div>
        <label>Role</label>
        <select value={edit.role} onChange={e => set('role', e.target.value)}>
          {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <p className="mt-1 text-[11px] text-slate2">
          The role decides their rights. Change one person only on the Rights tab.
        </p>
      </div>

      <div>
        <label>Approval limit ₹ (0 = no limit)</label>
        <input type="number" value={edit.approval_limit || 0}
          onChange={e => set('approval_limit', e.target.value)} />
        <p className="mt-1 text-[11px] text-slate2">
          A limit stops approvals above this value even if the right is on.
        </p>
      </div>

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

      {isSelf && (
        <p className="rounded-md bg-gold/10 px-3 py-2 text-[12px] text-gold">
          This is your own account. If you remove your admin role or switch yourself
          off, you lose access immediately and someone else must put it back from
          Supabase.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Rights({ edit, setEdit, groups, rolePerms, allCodes }) {
  const eff = effectivePerms(edit, rolePerms, allCodes)
  const admin = edit.role === 'admin'

  function toggle(code) {
    setEdit(u => toggleUserPerm(u, code, rolePerms))
  }

  function resetToRole() {
    setEdit(u => ({ ...u, perm_grant: [], perm_deny: [] }))
  }

  if (admin) {
    return (
      <p className="rounded-md bg-paper px-3 py-4 text-sm text-slate2">
        Admin has every right, always. That cannot be edited — it is what stops
        the system from locking everyone out. To limit this person, give them the
        Purchase HOD role instead and adjust from there.
      </p>
    )
  }

  const custom = overrideCount(edit)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-slate2">
          Ticks come from the <strong>{roleLabel(edit.role)}</strong> role.
          Change one here and it becomes a personal exception for this person only.
        </p>
        {custom > 0 && (
          <button className="whitespace-nowrap text-[12px] font-semibold text-gold underline"
            onClick={resetToRole}>
            Reset {custom}
          </button>
        )}
      </div>

      {groups.map(g => (
        <div key={g.module}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate2">
            {g.label}
          </div>
          <ul className="card divide-y divide-line">
            {g.perms.map(p => {
              const on = eff.has(p.code)
              const over = isOverride(edit, p.code)
              return (
                <li key={p.code}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                    <input type="checkbox" className="!w-auto mt-0.5"
                      checked={on} onChange={() => toggle(p.code)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold normal-case tracking-normal">
                        {p.label}
                        {over && (
                          <span className={'ml-2 tag ' +
                            (on ? 'bg-good/15 text-good' : 'bg-bad/10 text-bad')}>
                            {on ? 'added' : 'removed'}
                          </span>
                        )}
                      </span>
                      {p.hint && (
                        <span className="block text-[11px] text-slate2">{p.hint}</span>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
