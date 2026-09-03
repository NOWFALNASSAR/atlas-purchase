import { useEffect, useMemo, useState } from 'react'
import { db, roleLabel } from '../lib/db'
import { EDITABLE_ROLES, loadRights, groupByModule } from '../lib/perms'

export default function Roles() {
  const [permissions, setPermissions] = useState([])
  const [rolePerms, setRolePerms] = useState({})
  const [role, setRole] = useState('executive')
  const [draft, setDraft] = useState(new Set())
  const [counts, setCounts] = useState({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [rights, { data: profiles }] = await Promise.all([
      loadRights(),
      db.from('profiles').select('role').eq('active', true)
    ])
    setPermissions(rights.permissions)
    setRolePerms(rights.rolePerms)
    setDraft(new Set(rights.rolePerms[role] || []))

    const c = {}
    for (const p of profiles || []) c[p.role] = (c[p.role] || 0) + 1
    setCounts(c)
  }

  function pickRole(r) {
    setRole(r)
    setDraft(new Set(rolePerms[r] || []))
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

  const groups = useMemo(() => groupByModule(permissions), [permissions])
  const original = useMemo(() => new Set(rolePerms[role] || []), [rolePerms, role])
  const dirty = useMemo(() =>
    draft.size !== original.size || [...draft].some(c => !original.has(c)),
    [draft, original])

  function toggleGroup(g) {
    const codes = g.perms.map(p => p.code)
    const allOn = codes.every(c => draft.has(c))
    setSaved(false)
    setDraft(d => {
      const n = new Set(d)
      codes.forEach(c => allOn ? n.delete(c) : n.add(c))
      return n
    })
  }

  async function save() {
    setBusy(true)
    const del = await db.from('role_permissions').delete().eq('role', role)
    if (del.error) { setBusy(false); return alert(del.error.message) }

    if (draft.size) {
      const rowsToAdd = [...draft].map(code => ({ role, permission_code: code }))
      const ins = await db.from('role_permissions').insert(rowsToAdd)
      if (ins.error) { setBusy(false); return alert(ins.error.message) }
    }

    setRolePerms(rp => ({ ...rp, [role]: [...draft] }))
    setBusy(false)
    setSaved(true)
  }

  return (
    <div className="page page-md space-y-4 pb-24">
      <div>
        <h1 className="text-xl font-bold">Roles</h1>
        <p className="text-sm text-slate2">
          What each role can do by default. Change it here and it applies to
          everyone on that role at once — except where you set a personal
          exception for someone on the Users page.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {EDITABLE_ROLES.map(r => (
          <button key={r} onClick={() => pickRole(r)}
            className={'rounded-md px-3 py-2 text-sm font-semibold ' +
              (role === r ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {roleLabel(r)}
            <span className={'ml-1.5 text-[11px] font-normal ' +
              (role === r ? 'text-white/60' : 'text-slate2')}>
              {counts[r] || 0}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-md bg-paper px-3 py-2 text-[12px] text-slate2">
        Admin / MD is not listed. Admin always has every right, so that you can
        never lock yourself out of your own system.
      </div>

      {groups.map(g => {
        const codes = g.perms.map(p => p.code)
        const on = codes.filter(c => draft.has(c)).length
        return (
          <div key={g.module}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate2">
                {g.label} · {on}/{codes.length}
              </span>
              <button className="text-[12px] font-semibold text-gold underline"
                onClick={() => toggleGroup(g)}>
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
                      {p.hint && (
                        <span className="block text-[11px] text-slate2">{p.hint}</span>
                      )}
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
          <div className="page page-md flex items-center gap-3">
            <span className="flex-1 text-[12px] text-slate2">
              {saved
                ? `Saved. ${counts[role] || 0} ${counts[role] === 1 ? 'person is' : 'people are'} on this role.`
                : `Unsaved changes to ${roleLabel(role)}.`}
            </span>
            {dirty && (
              <>
                <button className="btn-ghost" onClick={() => pickRole(role)}>Undo</button>
                <button className="btn-dark" disabled={busy} onClick={save}>
                  {busy ? 'Saving' : 'Save role'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
