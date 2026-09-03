import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { loadRights, groupByModule, BASE_ROLES } from '../lib/perms'

/* ==================================================================
   ROLES

   Roles are rows in a table now, not a fixed list in the code, so you
   can add Sales Manager or Godown Manager without anyone touching the
   app.

   Each role carries a BASE ROLE. That is its authority level in the
   database — the twenty-odd security policies written before this
   screen existed all test the base role, so a new role slots straight
   in without any of them being rewritten.

   Base role decides what the DATABASE allows.
   The ticks below decide what the APP shows and offers.
   ================================================================== */

const BASE_HINT = {
  admin:     'Every right, always. Cannot be limited.',
  hod:       'Can own the supplier and item masters.',
  manager:   'Can approve within a rupee limit.',
  executive: 'Raises work, does not approve it.',
  accounts:  'Reads across the business, writes little.'
}

export default function Roles() {
  const [permissions, setPermissions] = useState([])
  const [rolePerms, setRolePerms] = useState({})
  const [roles, setRoles] = useState([])
  const [counts, setCounts] = useState({})

  const [role, setRole] = useState(null)
  const [draft, setDraft] = useState(new Set())
  const [adding, setAdding] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  useEffect(() => { load() }, [])

  async function load(keep) {
    setLoading(true)
    let rights, profiles
    try {
      const res = await Promise.all([
        loadRights(),
        db.from('profiles').select('role').eq('active', true)
      ])
      rights = res[0]; profiles = res[1].data
      setFailed(null)
    } catch (err) {
      setFailed(err?.message || 'Could not load roles')
      setLoading(false)
      return
    }
    setPermissions(rights.permissions)
    setRolePerms(rights.rolePerms)
    setRoles(rights.roles)

    const c = {}
    for (const p of profiles || []) c[p.role] = (c[p.role] || 0) + 1
    setCounts(c)

    const editable = rights.roles.filter(r => r.base_role !== 'admin')
    const next = keep && editable.some(r => r.code === keep) ? keep : editable[0]?.code || null
    setRole(next)
    setDraft(new Set(rights.rolePerms[next] || []))
    setLoading(false)
  }

  function pick(code) {
    setRole(code)
    setDraft(new Set(rolePerms[code] || []))
    setSaved(false)
  }

  function toggle(code) {
    setSaved(false)
    setDraft(d => {
      const n = new Set(d)
      n.has(code) ? n.delete(code) : n.add(code)
      return n
    })
  }

  const groups   = useMemo(() => groupByModule(permissions), [permissions])
  const original = useMemo(() => new Set(rolePerms[role] || []), [rolePerms, role])
  const dirty    = useMemo(() =>
    draft.size !== original.size || [...draft].some(c => !original.has(c)),
    [draft, original])

  const editable = roles.filter(r => r.base_role !== 'admin')
  const adminish = roles.filter(r => r.base_role === 'admin')
  const current  = roles.find(r => r.code === role)

  function toggleGroup(g) {
    const codes = g.perms.map(p => p.code)
    const allOn = codes.every(c => draft.has(c))
    setSaved(false)
    setDraft(d => {
      const n = new Set(d)
      codes.forEach(c => (allOn ? n.delete(c) : n.add(c)))
      return n
    })
  }

  async function save() {
    setBusy(true)
    const del = await db.from('role_permissions').delete().eq('role', role)
    if (del.error) { setBusy(false); return alert(del.error.message) }

    if (draft.size) {
      const ins = await db.from('role_permissions')
        .insert([...draft].map(code => ({ role, permission_code: code })))
      if (ins.error) { setBusy(false); return alert(ins.error.message) }
    }

    setRolePerms(rp => ({ ...rp, [role]: [...draft] }))
    setBusy(false)
    setSaved(true)
  }

  async function createRole() {
    const a = adding
    if (!a.label.trim()) return alert('Give the role a name')
    const code = a.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (!code) return alert('That name has no letters in it')
    if (roles.some(r => r.code === code)) return alert('A role with that name already exists')

    setBusy(true)
    const { error } = await db.from('roles').insert({
      code, label: a.label.trim(), base_role: a.base_role,
      sort_order: 500, built_in: false
    })

    if (!error && a.copyFrom) {
      const src = rolePerms[a.copyFrom] || []
      if (src.length) {
        await db.from('role_permissions')
          .insert(src.map(permission_code => ({ role: code, permission_code })))
      }
    }

    setBusy(false)
    if (error) return alert(error.message)
    setAdding(null)
    load(code)
  }

  async function removeRole() {
    if (!current || current.built_in) return
    if (!confirm(`Delete the ${current.label} role?`)) return
    setBusy(true)
    const { error } = await db.from('roles').delete().eq('code', current.code)
    setBusy(false)
    if (error) return alert(error.message)
    load()
  }

  if (failed) {
    return (
      <div className="page page-lg py-10">
        <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
          <div className="font-semibold">Could not load roles</div>
          <div className="mt-0.5">{failed}</div>
          <p className="mt-2 text-xs">
            If this says the roles table does not exist, run
            supabase/24_roles.sql in Supabase.
          </p>
          <button className="btn-ghost btn-sm mt-3" onClick={() => load()}>Try again</button>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="page page-lg space-y-3">
      <div className="card h-24 animate-pulse bg-line2" />
      <div className="card h-64 animate-pulse bg-line2" />
    </div>
  }

  return (
    <div className="page page-lg space-y-4 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Roles</h1>
          <p className="text-sm text-slate2">
            What each role can do by default. Change it here and it applies to
            everyone on that role, except where you set a personal exception on
            the Users page.
          </p>
        </div>
        <button className="btn-dark"
          onClick={() => setAdding({ label: '', base_role: 'manager', copyFrom: role })}>
          New role
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {editable.map(r => (
          <button key={r.code} onClick={() => pick(r.code)}
            className={'rounded-md px-3 py-2 text-sm font-semibold ' +
              (role === r.code ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {r.label}
            <span className={'ml-1.5 text-2xs font-normal ' +
              (role === r.code ? 'text-white/60' : 'text-mute')}>
              {counts[r.code] || 0}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-md bg-paper px-3 py-2.5 text-xs text-slate2">
        {adminish.map(r => r.label).join(' and ')} carry admin authority — they hold
        every right and are not listed above. That is what stops you locking
        yourself out of your own system.
      </div>

      {current && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm font-semibold">{current.label}</div>
            <div className="text-xs text-slate2">
              Authority level: {current.base_role}
              {BASE_HINT[current.base_role] && ` — ${BASE_HINT[current.base_role]}`}
            </div>
            <div className="mt-0.5 text-2xs text-mute">
              {counts[current.code] || 0} active {counts[current.code] === 1 ? 'person' : 'people'}
              {current.built_in && ' · built in'}
            </div>
          </div>
          {!current.built_in && (
            <button className="btn-ghost btn-sm text-bad" onClick={removeRole} disabled={busy}>
              Delete role
            </button>
          )}
        </div>
      )}

      {groups.map(g => {
        const codes = g.perms.map(p => p.code)
        const on = codes.filter(c => draft.has(c)).length
        return (
          <div key={g.module}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-wider text-slate2">
                {g.label} · {on}/{codes.length}
              </span>
              <button className="text-xs font-semibold text-gold" onClick={() => toggleGroup(g)}>
                {on === codes.length ? 'None' : 'All'}
              </button>
            </div>
            <ul className="card divide-y divide-line">
              {g.perms.map(p => (
                <li key={p.code}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                    <input type="checkbox" className="!w-auto mt-0.5"
                      checked={draft.has(p.code)} onChange={() => toggle(p.code)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold normal-case tracking-normal">
                        {p.label}
                      </span>
                      {p.hint && <span className="block text-2xs text-slate2">{p.hint}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      {(dirty || saved) && (
        <div className="fixed inset-x-0 bottom-[3.25rem] z-30 border-t border-line bg-white px-4 py-3 shadow-pop md:static md:border-0 md:bg-transparent md:px-0 md:shadow-none">
          <div className="page page-lg flex items-center gap-3">
            <span className="flex-1 text-xs text-slate2">
              {saved
                ? `Saved. ${counts[role] || 0} ${counts[role] === 1 ? 'person is' : 'people are'} on this role.`
                : `Unsaved changes to ${current?.label || role}.`}
            </span>
            {dirty && (
              <>
                <button className="btn-ghost" onClick={() => pick(role)}>Undo</button>
                <button className="btn-dark" disabled={busy} onClick={save}>
                  {busy ? 'Saving' : 'Save role'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
          onClick={() => setAdding(null)}>
          <div className="safe-b w-full max-w-lg rounded-t-xl bg-white p-5 shadow-pop md:rounded-xl"
            onClick={e => e.stopPropagation()}>
            <h2 className="mb-4 text-base font-semibold">New role</h2>

            <div className="space-y-4">
              <div>
                <label>Role name</label>
                <input value={adding.label} placeholder="Sales Manager"
                  onChange={e => setAdding(v => ({ ...v, label: e.target.value }))} />
              </div>

              <div>
                <label>Authority level</label>
                <select value={adding.base_role}
                  onChange={e => setAdding(v => ({ ...v, base_role: e.target.value }))}>
                  {BASE_ROLES.filter(b => b !== 'admin').map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <p className="mt-1 text-2xs text-slate2">
                  {BASE_HINT[adding.base_role]} This sets what the database itself
                  allows. The ticks on the previous screen set what the app shows.
                </p>
              </div>

              <div>
                <label>Start from</label>
                <select value={adding.copyFrom || ''}
                  onChange={e => setAdding(v => ({ ...v, copyFrom: e.target.value || null }))}>
                  <option value="">Nothing — start empty</option>
                  {editable.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
                <p className="mt-1 text-2xs text-slate2">
                  Copies that role's rights as a starting point. Adjust after saving.
                </p>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button className="btn-dark flex-1" disabled={busy} onClick={createRole}>
                {busy ? 'Creating' : 'Create role'}
              </button>
              <button className="btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
