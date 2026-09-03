import { JSDOM, VirtualConsole } from 'jsdom'
import fs from 'fs'

const ROLE  = process.argv[2] || 'admin'
const PERMS = JSON.parse(process.argv[3] || 'null')   // null = RPC fails

let js = fs.readFileSync(
  fs.readdirSync('dist/assets')
    .filter(f => f.startsWith('index-') && f.endsWith('.js'))
    .map(f => 'dist/assets/' + f)[0], 'utf8')
js = js.replace(/export\{[^}]*\};?/g, '')

const errs = []
const vc = new VirtualConsole()
vc.on('jsdomError', e => { const m = String(e.stack || e.message); if (!m.includes('getContext')) errs.push('jsdomError: ' + m) })
vc.on('error', (...a) => errs.push('console.error: ' + a.map(String).join(' ')))

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  runScripts: 'outside-only', url: 'https://app.test/', pretendToBeVisual: true, virtualConsole: vc
})
const w = dom.window

w.matchMedia = q => ({ matches: /min-width: 1024px/.test(q), media: q,
  addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} })
w.scrollTo = () => {}
w.Response = Response; w.Headers = Headers; w.Request = Request; w.AbortController = AbortController

const USER = { id: 'u1', email: 'test@atlas.in', aud: 'authenticated', role: 'authenticated' }
w.localStorage.setItem('sb-x-auth-token', JSON.stringify({
  access_token: 'fake', refresh_token: 'fake', token_type: 'bearer',
  expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: USER
}))

const json = body => new w.Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json' }
})

const PROFILE = {
  id: 'u1', full_name: 'Test Person', emp_code: 'E1', phone: '',
  role: ROLE, entity_ids: [], approval_limit: 0, active: true,
  perm_grant: [], perm_deny: []
}

const ROWS = {
  entities: [{ id: 'e1', code: 'E1', name: 'Entity One', active: true },
             { id: 'e2', code: 'E2', name: 'Entity Two', active: true }],
  purchase_orders: [{
    id: 'p1', po_no: 'ATL/E1/PO/26-27/00125', status: 'pending', pending_role: 'manager',
    total_purchase: 125000, created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    created_by: 'u1', entity_id: 'e1',
    suppliers: { name: 'ABC Textiles' }, entities: { code: 'E1', name: 'Entity One' }
  }],
  v_stock_by_division: [{ label: 'Ladies', items: 12, qty: 900, purchase_value: 400000, cost_value: 450000, selling_value: 700000, avg_margin: 35 }],
  v_dead_stock: [{ cost_value: 25000 }],
  v_in_transit: [{ doc_no: 'T-1' }],
  v_sales_today: [{ branch_id: 'b1', branch_code: 'S01', branch_name: 'Thodupuzha', entity_id: 'e1', bills: 40, qty: 120, net_sales: 220000, yesterday_sales: 180000 }],
  v_target_progress: [{ branch_id: 'b1', branch_name: 'Thodupuzha', entity_id: 'e1', target: 5000000, achieved: 2200000, achievement_pct: 44, status: 'critical' }],
  v_tasks: [{ id: 't1', task_no: 'T-1', title: 'Fix the AC in showroom', status: 'raised', priority: 'urgent', due_date: '2026-08-01', overdue: true, ack_overdue: true, to_dept_name: 'Maintenance' }],
  permissions: [], role_permissions: []
}

const hits = []
w.fetch = async (url, opts = {}) => {
  const u = String(url?.url || url)
  hits.push((opts.method || 'GET') + ' ' + u.replace('https://x.supabase.co', ''))

  if (u.includes('/rest/v1/rpc/my_permissions'))
    return PERMS === null
      ? new w.Response(JSON.stringify({ message: 'function does not exist' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      : json(PERMS)

  if (u.includes('/rest/v1/profiles')) return json(PROFILE)

  const table = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]
  if (table) return json(ROWS[table] ?? [])
  if (u.includes('/auth/v1/user')) return json(USER)
  return json({})
}

try { w.eval(js) } catch (e) { errs.push('EVAL THREW: ' + e.stack) }
await new Promise(r => setTimeout(r, 1500))

const root = w.document.getElementById('root')
const text = (root.textContent || '').replace(/\s+/g, ' ').trim()

console.log(`\n=== role=${ROLE}  perms=${PERMS === null ? 'RPC FAILS' : PERMS.length + ' codes'} ===`)
console.log('root html bytes :', root.innerHTML.length)
console.log('render          :', text ? text.slice(0, 260) : '*** BLANK WHITE PAGE ***')
console.log('--- requests ---'); console.log(hits.join('\n') || '(none)')
if (errs.length) {
  console.log('--- errors ---')
  console.log([...new Set(errs)].slice(0, 4).join('\n'))
}
