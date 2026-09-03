import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, lakh, inr, dt, num, statusStyle } from '../lib/db'
import { openWhatsApp } from '../lib/wa'

/* ==================================================================
   DEPARTMENT WINDOW

   Pick a department and see everything it does, not just its tasks.
   Purchase raises orders. A showroom holds stock. Everybody sends and
   receives work.

   Every number on this page is a link into the thing it counts. A
   figure you cannot open is a figure nobody trusts.
   ================================================================== */

const STATUS_LABEL = {
  raised: 'New', reissued: 'Reissued', acknowledged: 'Accepted',
  in_progress: 'In progress', completed: 'Awaiting check',
  verified: 'Closed', cancelled: 'Cancelled', disputed: 'With MD Office'
}

export default function DeptPerformance() {
  const [depts, setDepts] = useState([])
  const [pick, setPick] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  const [tasksIn, setTasksIn] = useState([])
  const [tasksOut, setTasksOut] = useState([])
  const [orders, setOrders] = useState([])
  const [people, setPeople] = useState([])
  const [view, setView] = useState('in')

  useEffect(() => { loadDepts() }, [])
  useEffect(() => { if (pick) loadDetail(pick) }, [pick])

  async function loadDepts() {
    setLoading(true)
    const { data, error } = await db.from('v_dept_overview').select('*').order('sort_order')
    if (error) { setFailed(error.message); setLoading(false); return }
    setDepts(data || [])
    setLoading(false)
  }

  async function loadDetail(id) {
    const [ti, to, pe] = await Promise.all([
      db.from('v_task_full').select('*').eq('to_dept', id)
        .order('created_at', { ascending: false }).limit(200),
      db.from('v_task_full').select('*').eq('from_dept', id)
        .order('created_at', { ascending: false }).limit(200),
      db.from('v_dept_people').select('*').eq('department_id', id)
    ])
    setTasksIn(ti.data || [])
    setTasksOut(to.data || [])
    setPeople(pe.data || [])

    const ids = (pe.data || []).map(p => p.profile_id)
    if (ids.length) {
      const { data } = await db.from('purchase_orders')
        .select('id,po_no,status,total_purchase,created_at,suppliers(name)')
        .in('created_by', ids)
        .order('created_at', { ascending: false }).limit(100)
      setOrders(data || [])
    } else setOrders([])
  }

  const current = useMemo(() => depts.find(d => d.id === pick), [depts, pick])

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load departments</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_dept_overview, run
          supabase/28_dept_activity_mrf_eod.sql in Supabase.
        </p>
      </div>
    </div>
  )

  /* ---------- the list ---------- */

  if (!pick) {
    const dd = depts.filter(d => d.kind !== 'showroom')
    const sr = depts.filter(d => d.kind === 'showroom')

    return (
      <div className="page page-xl space-y-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Departments</h1>
          <p className="text-sm text-slate2">
            Everything each department does. Open one to see its work and click
            through to any of it.
          </p>
        </div>

        {loading ? <div className="card h-64 animate-pulse bg-line2" /> : (
          <>
            <Group title="Departments" rows={dd} onPick={setPick} />
            {sr.length > 0 && <Group title="Showrooms" rows={sr} onPick={setPick} />}
          </>
        )}
      </div>
    )
  }

  /* ---------- one department ---------- */

  const rows = view === 'in' ? tasksIn : view === 'out' ? tasksOut : []

  return (
    <div className="page page-xl space-y-5">
      <button onClick={() => setPick(null)} className="text-sm font-medium text-slate2">
        All departments
      </button>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">{current?.name}</h1>
          <p className="text-sm text-slate2">
            {current?.kind === 'showroom' ? 'Showroom' : current?.code}
            {' · '}{current?.people || 0} {current?.people === 1 ? 'person' : 'people'}
            {current?.hod_name && ` · ${current.hod_name}`}
          </p>
        </div>
        {current?.whatsapp && (
          <button className="btn-ghost btn-sm"
            onClick={() => openWhatsApp(current.whatsapp,
              `${current.name} — ${current.tasks_open} task${current.tasks_open === 1 ? '' : 's'} open, ` +
              `${current.tasks_overdue} overdue.\n\nAtlas`)}>
            Message on WhatsApp
          </button>
        )}
      </div>

      {/* tasks */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Task management</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Sent to them" value={current?.tasks_received || 0}
            onClick={() => setView('in')} />
          <Stat label="Still open" value={current?.tasks_open || 0}
            tone={current?.tasks_open ? 'warn' : undefined} onClick={() => setView('in')} />
          <Stat label="Overdue" value={current?.tasks_overdue || 0}
            tone={current?.tasks_overdue ? 'bad' : undefined} onClick={() => setView('in')} />
          <Stat label="They raised" value={current?.tasks_raised || 0}
            onClick={() => setView('out')} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Small label="Closed" value={current?.tasks_closed || 0} />
          <Small label="Disputed" value={current?.tasks_disputed || 0} />
          <Small label="Hours to accept"
            value={current?.avg_hours_to_accept != null ? num(current.avg_hours_to_accept, 1) : '—'} />
          <Small label="Days to close"
            value={current?.avg_days_to_close != null ? num(current.avg_days_to_close, 1) : '—'} />
        </div>
      </section>

      {/* purchase, only when there is any */}
      {(current?.po_orders > 0) && (
        <section>
          <h2 className="mb-2 text-base font-semibold">Purchase</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Bought" value={lakh(current.po_value)}
              sub={current.po_orders + ' orders'} feature />
            <Stat label="Awaiting approval" value={current.po_pending}
              sub={current.po_pending_value ? lakh(current.po_pending_value) : null}
              tone={current.po_pending ? 'warn' : undefined} />
            <Stat label="Drafts" value={current.po_drafts} />
            <Stat label="Rejected" value={current.po_rejected || 0} />
          </div>

          {orders.length > 0 && (
            <div className="card mt-3 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2.5 text-left">Supplier</th>
                    <th className="px-3 py-2.5 text-left">Order</th>
                    <th className="px-3 py-2.5 text-left">Raised</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="px-4 py-2.5 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 12).map(o => (
                    <tr key={o.id} className="border-t border-line">
                      <td className="px-4 py-2.5">
                        <Link to={'/orders/' + o.id} className="font-medium hover:underline">
                          {o.suppliers?.name || 'Supplier'}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-2xs text-slate2">{o.po_no}</td>
                      <td className="px-3 py-2.5 text-slate2">{dt(o.created_at)}</td>
                      <td className="px-3 py-2.5">
                        <span className={'tag ' + statusStyle(o.status)}>{o.status}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{inr(o.total_purchase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* the tasks themselves */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Tasks</h2>
          <div className="flex gap-1 rounded-md bg-paper p-1">
            {[['in', `Sent to them (${tasksIn.length})`],
              ['out', `They raised (${tasksOut.length})`],
              ['people', `People (${people.length})`]].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                className={'rounded px-3 py-1.5 text-sm font-semibold ' +
                  (view === k ? 'bg-white text-ink shadow-card' : 'text-slate2')}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {view === 'people' ? (
          people.length === 0 ? (
            <div className="card p-6 text-center text-sm text-slate2">
              Nobody is in this department yet. Add them on Masters → Users,
              Departments tab.
            </div>
          ) : (
            <ul className="card divide-y divide-line">
              {people.map(p => (
                <li key={p.profile_id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1 text-sm font-medium">{p.full_name}</span>
                  <span className="text-xs text-slate2">{p.username}</span>
                  <span className="tag bg-line text-slate2">{p.post}</span>
                </li>
              ))}
            </ul>
          )
        ) : rows.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate2">Nothing here yet.</div>
        ) : (
          <ul className="card divide-y divide-line">
            {rows.slice(0, 60).map(t => (
              <li key={t.id}>
                <Link to={'/tasks/' + t.id} className="block px-4 py-3 hover:bg-paper">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.title}</span>
                        {t.task_type !== 'general' && (
                          <span className="tag bg-ink/10 text-ink">{t.task_type}</span>
                        )}
                        {t.priority !== 'normal' && (
                          <span className="tag bg-gold2 text-gold">{t.priority}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-2xs text-slate2">
                        <span className="font-mono">{t.task_no}</span>
                        {' · '}{view === 'in' ? t.from_dept_name : t.to_dept_name}
                        {t.due_date && ' · due ' + dt(t.due_date)}
                        {t.points > 0 && ` · ${t.points_done}/${t.points} points`}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs">{STATUS_LABEL[t.status] || t.status}</span>
                      {t.overdue && (
                        <span className="block text-2xs font-semibold text-bad">late</span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Group({ title, rows, onPick }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-2.5 text-left">Department</th>
              <th className="px-3 py-2.5 text-right">People</th>
              <th className="px-3 py-2.5 text-right">Tasks in</th>
              <th className="px-3 py-2.5 text-right">Open</th>
              <th className="px-3 py-2.5 text-right">Late</th>
              <th className="px-3 py-2.5 text-right">Raised</th>
              <th className="px-4 py-2.5 text-right">Purchase</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.id} className="cursor-pointer border-t border-line hover:bg-paper"
                onClick={() => onPick(d.id)}>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{d.name}</span>
                  {d.is_md_office && <span className="ml-2 tag bg-gold2 text-gold">MD</span>}
                  {!d.whatsapp && (
                    <span className="ml-2 tag bg-line text-slate2">no number</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-slate2">{d.people}</td>
                <td className="px-3 py-2.5 text-right">{d.tasks_received}</td>
                <td className="px-3 py-2.5 text-right">{d.tasks_open}</td>
                <td className={'px-3 py-2.5 text-right ' +
                  (d.tasks_overdue > 0 ? 'font-semibold text-bad' : '')}>{d.tasks_overdue}</td>
                <td className="px-3 py-2.5 text-right text-slate2">{d.tasks_raised}</td>
                <td className="px-4 py-2.5 text-right">
                  {d.po_value > 0 ? lakh(d.po_value) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Stat({ label, value, sub, feature, tone, onClick }) {
  const tones = { bad: 'border-bad/30 bg-bad/[.04]', warn: 'border-warn/30 bg-warn/[.05]' }
  return (
    <button onClick={onClick} disabled={!onClick}
      className={'card h-full p-4 text-left transition ' +
        (feature ? 'border-ink bg-ink text-white ' : tones[tone] || '') +
        (onClick ? ' hover:border-mute' : '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight lg:text-2xl">{value}</div>
      {sub && <div className={'mt-0.5 text-xs ' + (feature ? 'text-white/60' : 'text-slate2')}>{sub}</div>}
    </button>
  )
}

function Small({ label, value }) {
  return (
    <div className="card p-3">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-base font-semibold">{value}</div>
    </div>
  )
}
