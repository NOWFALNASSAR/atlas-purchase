import { useEffect, useMemo, useState } from 'react'
import { db, inr } from '../lib/db'
import { Modal } from './Suppliers'
import {
  loadRights, groupByModule, effectivePerms, isAdminRole, labelOf,
  toggleUserPerm, isOverride, overrideCount
} from '../lib/perms'
import { useMe } from '../App'

export default function Users() {
  const me = useMe()
  const [rows, setRows] = useState([])
  const [entities, setEntities] = useState([])
  const [permissions, setPermissions] = useState([])
  const [rolePerms, setRolePerms] = useState({})
  const [roles, setRoles] = useState([])
  const [q, setQ] = useState('')
  const [showOff, setShowOff] = useState(true)
  const [edit, setEdit] = useState(null)
  const [tab, setTab] = useState('details')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(null)
  const [pwFor, setPwFor] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const [{ data: p }, { data: e }, rights] = await Promise.all([
        db.from('profiles').select('*').order('full_name'),
        db.from('entities').select('*').eq('active', true).order('code'),
        loadRights()
      ])
      setRows(p || [])
      setEntities(e || [])
      setPermissions(rights.permissions)
      setRolePerms(rights.rolePerms)
      setRoles(rights.roles)
      setFailed(null)
    } catch (err) {
      // An empty list with no explanation is the worst outcome here —
      // it looks like there are no users rather than like a failure.
      setFailed(err?.message || 'Could not load users')
    }
  }

  const allCodes = useMemo(() => permissions.map(p => p.code), [permissions])
  const groups = useMemo(() => groupByModule(permissions), [permissions])

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(u => {
      if (!showOff && !u.active) return false
      if (!t) return true
      return [u.full_name, u.username, u.emp_code, u.phone, labelOf(u.role, roles)]
        .some(v => (v || '').toLowerCase().includes(t))
    })
  }, [rows, q, showOff, roles])

  function open(u) {
    setEdit({ ...u, perm_grant: u.perm_grant || [], perm_deny: u.perm_deny || [] })
    setTab('details')
  }

  async function save() {
    setBusy(true)
    const { error } = await db.from('profiles').update({
      full_name:      edit.full_name,
      username:       (edit.username || '').trim().toLowerCase() || null,
      emp_code:       edit.emp_code,
      phone:          edit.phone,
      role:           edit.role,
      entity_ids:     edit.entity_ids || [],
      approval_limit: Number(edit.approval_limit) || 0,
      perm_grant:     isAdminRole(edit.role, roles) ? [] : (edit.perm_grant || []),
      perm_deny:      isAdminRole(edit.role, roles) ? [] : (edit.perm_deny || []),
      active:         edit.active
    }).eq('id', edit.id)
    setBusy(false)
    if (error) return alert(error.message)
    setEdit(null)
    load()
  }

  async function setPassword() {
    if ((pwFor.pw || '').length < 6) return alert('At least 6 characters')
    setBusy(true)
    const { error } = await db.rpc('admin_set_password',
      { p_profile: pwFor.id, p_password: pwFor.pw })
    setBusy(false)
    if (error) return alert(error.message)
    alert(`Password set. Tell ${pwFor.name} to sign in with their username and this password.`)
    setPwFor(null)
  }

  function toggleEntity(id) {
    setEdit(u => {
      const cur = u.entity_ids || []
      return { ...u, entity_ids: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }
    })
  }

  return (
    <div className="page page-md space-y-4">
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

      {failed && (
        <div className="card border-bad/30 bg-bad/[.04] p-4 text-sm text-bad">
          <div className="font-semibold">Could not load users</div>
          <div className="mt-0.5">{failed}</div>
          <button className="btn-ghost btn-sm mt-3" onClick={load}>Try again</button>
        </div>
      )}

      <ul className="card divide-y divide-line">
        {visible.map(u => {
          const eff = effectivePerms(u, rolePerms, allCodes, roles)
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
                    {u.username ? u.username + ' · ' : ''}{labelOf(u.role, roles)}
                    {u.approval_limit > 0 && ' · up to ' + inr(u.approval_limit)}
                    {isAdminRole(u.role, roles)
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

      {pwFor && (
        <Modal title={'Set a password for ' + pwFor.name} onClose={() => setPwFor(null)}>
          <p className="mb-3 text-sm text-slate2">
            There is no email in this system, so there is no reset link. You set the
            password and tell them what it is. They can change it later by asking you
            again.
          </p>
          <div>
            <label>New password</label>
            <input type="text" value={pwFor.pw} autoComplete="off" minLength={6}
              onChange={e => setPwFor(v => ({ ...v, pw: e.target.value }))}
              placeholder="At least 6 characters" />
            <p className="mt-1 text-2xs text-slate2">
              Shown as plain text on purpose — you have to read it out to them.
            </p>
          </div>
          <button className="btn-dark mt-4 w-full" disabled={busy} onClick={setPassword}>
            {busy ? 'Setting' : 'Set password'}
          </button>
        </Modal>
      )}

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
            <Details edit={edit} setEdit={setEdit} entities={entities} roles={roles}
              toggleEntity={toggleEntity} isSelf={edit.id === me.id} />
          ) : (
            <Rights edit={edit} setEdit={setEdit} groups={groups} roles={roles}
              rolePerms={rolePerms} allCodes={allCodes} />
          )}

          <div className="mt-4 flex gap-2">
            <button className="btn-dark flex-1" disabled={busy} onClick={save}>
              {busy ? 'Saving' : 'Save user'}
            </button>
            <button className="btn-ghost" disabled={busy}
              onClick={() => setPwFor({ id: edit.id, name: edit.full_name || edit.username, pw: '' })}>
              Set password
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Details({ edit, setEdit, entities, roles, toggleEntity, isSelf }) {
  const set = (k, v) => setEdit(u => ({ ...u, [k]: v }))

  return (
    <div className="space-y-3">
      <div>
        <label>Full name</label>
        <input value={edit.full_name || ''} onChange={e => set('full_name', e.target.value)} />
      </div>

      <div>
        <label>Username</label>
        <input value={edit.username || ''} autoCapitalize="none" autoCorrect="off"
          onChange={e => set('username', e.target.value.replace(/\s+/g, ''))} />
        <p className="mt-1 text-2xs text-slate2">
          What they type to sign in. No spaces. Must not match anyone else.
        </p>
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
          {roles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
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

function Rights({ edit, setEdit, groups, roles, rolePerms, allCodes }) {
  const eff = effectivePerms(edit, rolePerms, allCodes, roles)
  const admin = isAdminRole(edit.role, roles)

  function toggle(code) {
    setEdit(u => toggleUserPerm(u, code, rolePerms, roles))
  }

  function resetToRole() {
    setEdit(u => ({ ...u, perm_grant: [], perm_deny: [] }))
  }

  if (admin) {
    return (
      <p className="rounded-md bg-paper px-3 py-4 text-sm text-slate2">
        This role carries admin authority, so it holds every right and cannot be
        edited. That is what stops the system from locking everyone out. To limit
        this person, move them to a different role and adjust from there.
      </p>
    )
  }

  const custom = overrideCount(edit)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-slate2">
          Ticks come from the <strong>{labelOf(edit.role, roles)}</strong> role.
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
          {failed && (
        <div className="card border-bad/30 bg-bad/[.04] p-4 text-sm text-bad">
          <div className="font-semibold">Could not load users</div>
          <div className="mt-0.5">{failed}</div>
          <button className="btn-ghost btn-sm mt-3" onClick={load}>Try again</button>
        </div>
      )}

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
