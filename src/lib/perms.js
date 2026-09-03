import { db } from './db'

/* The five roles. Admin is not editable — admin always has everything,
   so that you can never lock yourself out of your own system. */
export const ROLES = ['executive', 'manager', 'hod', 'accounts', 'admin']
export const EDITABLE_ROLES = ['executive', 'manager', 'hod', 'accounts']

export const MODULE_LABEL = {
  purchase: 'Purchase',
  stock:    'Stock',
  sales:    'Sales',
  tasks:    'Tasks',
  masters:  'Masters and setup'
}

const MODULE_ORDER = ['purchase', 'stock', 'sales', 'tasks', 'masters']

/* ---------- loading ------------------------------------------------ */

/** The whole catalogue plus every role default, in one round trip. */
export async function loadRights() {
  const [{ data: perms }, { data: rp }] = await Promise.all([
    db.from('permissions').select('*').eq('active', true).order('sort_order'),
    db.from('role_permissions').select('*')
  ])

  const byRole = {}
  for (const r of EDITABLE_ROLES) byRole[r] = []
  for (const row of rp || []) (byRole[row.role] ||= []).push(row.permission_code)

  return { permissions: perms || [], rolePerms: byRole }
}

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
export function effectivePerms(user, rolePerms, allCodes) {
  if (user.role === 'admin') return new Set(allCodes)
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
export function toggleUserPerm(user, code, rolePerms) {
  if (user.role === 'admin') return user

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
