import { db } from './db'

/* Roles live in the database now, so they can be added without a code
   change. Anything whose base_role is 'admin' always has every right and
   cannot be edited — that is what stops you locking yourself out. */
export const BASE_ROLES = ['executive', 'manager', 'hod', 'accounts', 'admin']

export const MODULE_LABEL = {
  purchase: 'Purchase',
  stock:    'Stock',
  sales:    'Sales',
  tasks:    'Tasks',
  masters:  'Masters and setup'
}

const MODULE_ORDER = ['purchase', 'stock', 'sales', 'tasks', 'masters']

/* ---------- loading ------------------------------------------------ */

/** The catalogue, every role, and every role default, in one round trip. */
export async function loadRights() {
  const [{ data: perms }, { data: rp }, { data: roleRows }] = await Promise.all([
    db.from('permissions').select('*').eq('active', true).order('sort_order'),
    db.from('role_permissions').select('*'),
    db.from('roles').select('*').eq('active', true).order('sort_order')
  ])

  // If 24_roles.sql has not been run, fall back to the original five so
  // the screen still works instead of showing an empty list.
  const roles = (roleRows || []).length ? roleRows : [
    { code: 'admin',     label: 'Admin / MD',         base_role: 'admin',     built_in: true },
    { code: 'hod',       label: 'Purchase HOD',       base_role: 'hod',       built_in: true },
    { code: 'manager',   label: 'Purchase Manager',   base_role: 'manager',   built_in: true },
    { code: 'executive', label: 'Purchase Executive', base_role: 'executive', built_in: true },
    { code: 'accounts',  label: 'Accounts',           base_role: 'accounts',  built_in: true }
  ]

  const byRole = {}
  for (const r of roles) byRole[r.code] = []
  for (const row of rp || []) (byRole[row.role] ||= []).push(row.permission_code)

  return { permissions: perms || [], rolePerms: byRole, roles }
}

/** Admin-authority roles hold every right and are not editable. */
export const isAdminRole = (role, roles) =>
  (roles.find(r => r.code === role)?.base_role || role) === 'admin'

export const labelOf = (code, roles) =>
  roles.find(r => r.code === code)?.label || code

/** Group the flat catalogue into the modules the menu already uses. */
export function groupByModule(permissions) {
  const map = {}
  for (const p of permissions) (map[p.module] ||= []).push(p)
  return MODULE_ORDER
    .filter(m => map[m])
    .map(m => ({ module: m, label: MODULE_LABEL[m] || m, perms: map[m] }))
}

/* ---------- the one rule ------------------------------------------- */

/** role defaults + personal grants − personal denies. Admin gets all. */
export function effectivePerms(user, rolePerms, allCodes, roles = []) {
  if (isAdminRole(user.role, roles)) return new Set(allCodes)
  const grant = user.perm_grant || []
  const deny = new Set(user.perm_deny || [])
  const out = new Set()
  for (const c of rolePerms[user.role] || []) if (!deny.has(c)) out.add(c)
  for (const c of grant) if (!deny.has(c)) out.add(c)
  return out
}

/** Turn one permission on or off for one person, keeping the arrays tidy.
 *  If the new value matches the role default we drop the override entirely,
 *  so the person keeps following their role when you later change the role. */
export function toggleUserPerm(user, code, rolePerms, roles = []) {
  if (isAdminRole(user.role, roles)) return user

  const roleHas = (rolePerms[user.role] || []).includes(code)
  const grant = new Set(user.perm_grant || [])
  const deny = new Set(user.perm_deny || [])
  const now = grant.has(code) ? true : deny.has(code) ? false : roleHas
  const next = !now

  grant.delete(code)
  deny.delete(code)
  if (next !== roleHas) (next ? grant : deny).add(code)

  return { ...user, perm_grant: [...grant], perm_deny: [...deny] }
}

/** Does this person differ from their role on this permission? */
export function isOverride(user, code) {
  return (user.perm_grant || []).includes(code) || (user.perm_deny || []).includes(code)
}

export function overrideCount(user) {
  return (user.perm_grant?.length || 0) + (user.perm_deny?.length || 0)
}
