import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, dt } from '../lib/db'
import { useMe, useCan } from '../App'

/* ==================================================================
   TASK DASHBOARD

   The first screen of the module. Cards, not a list — because the
   question somebody has when they open Tasks is "what needs me",
   and a list of everything answers that badly.

   Every number comes from the database, already counted. A dashboard
   that pulls two thousand rows to display the number 7 is the
   difference between a screen that opens and one that spins.
   ================================================================== */

export default function TaskHome() {
  const me = useMe()
  const can = useCan()

  const [c, setC] = useState(null)
  const [dept, setDept] = useState(null)
  const [org, setOrg] = useState(null)
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const mine = await db.from('department_members')
        .select('department_id, departments(is_md_office)')
        .eq('profile_id', me.id).eq('active', true)

      const myDepts = (mine.data || []).map(d => d.department_id)
      const isMd = (mine.data || []).some(d => d.departments?.is_md_office)
      const senior = isMd || me.role === 'admin'

      const [counts, today, orgRow, q] = await Promise.all([
        db.from('v_task_counts').select('*').maybeSingle(),
        myDepts.length
          ? db.from('v_dept_today').select('*').in('department_id', myDepts)
          : Promise.resolve({ data: [] }),
        senior ? db.from('v_org_today').select('*').maybeSingle()
               : Promise.resolve({ data: null }),
        senior
          ? db.from('v_management_queue').select('*')
              .order('days_waiting', { ascending: false }).limit(8)
          : Promise.resolve({ data: [] })
      ])

      if (counts.error) throw counts.error
      setC(counts.data)
      setDept((today.data || [])[0] || null)
      setOrg(orgRow.data || null)
      setQueue(q.data || [])
      setFailed(null)
    } catch (e) {
      setFailed(e.message)
    }
    setLoading(false)
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load the dashboard</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_task_counts or v_dept_today, run
          supabase/35_dashboards.sql in Supabase.
        </p>
      </div>
    </div>
  )

  if (loading) return (
    <div className="page page-xl space-y-3">
      <div className="card h-24 animate-pulse bg-line2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0,1,2,3,4,5,6,7].map(i => <div key={i} className="card h-24 animate-pulse bg-line2" />)}
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Task management</h1>
          <p className="text-sm text-slate2">
            {dept ? dept.name : 'Your work'}
            {' · '}{new Date().toLocaleDateString('en-IN',
              { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {can('tasks.create') && (
          <Link to="/tasks/new" className="btn-dark">Raise a task</Link>
        )}
      </div>

      {/* ---------- what needs me ---------- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">What needs you</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card to="/tasks/list?filter=mine" label="My tasks" value={c?.mine}
            hint="Assigned to you by name" />
          <Card to="/tasks/list?filter=dept" label="For my department" value={c?.for_my_dept}
            hint="Your department is answerable" feature />
          <Card to="/tasks/list?filter=accept" label="Waiting to accept" value={c?.to_accept}
            hint="Accept and commit a date" tone={c?.to_accept ? 'warn' : null} />
          <Card to="/tasks/list?filter=overdue" label="Overdue" value={c?.overdue}
            hint="Past the promised date" tone={c?.overdue ? 'bad' : null} />
        </div>
      </section>

      {/* ---------- today ---------- */}
      {dept && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">{dept.name} today</h2>
            <Link to="/tasks/pfd" className="text-sm text-slate2">Open the plan</Link>
          </div>

          <div className="card overflow-hidden">
            <div className={'flex flex-wrap items-center justify-between gap-3 px-4 py-3 ' +
              (dept.pfd_done ? 'bg-good/10' : 'bg-gold2')}>
              <div className={'text-sm font-semibold ' + (dept.pfd_done ? 'text-good' : 'text-gold')}>
                {dept.pfd_done
                  ? `Plan submitted at ${new Date(dept.pfd_at).toLocaleTimeString('en-IN',
                      { hour: 'numeric', minute: '2-digit' })}`
                  : 'The plan for today has not been submitted'}
              </div>
              {can('tasks.pfd') && (
                <Link to="/tasks/pfd" className="btn-ghost btn-sm">
                  {dept.pfd_done ? 'Review' : 'Plan the day'}
                </Link>
              )}
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
              <Mini label="Our regular work" value={dept.regular_tasks} />
              <Mini label="From other departments" value={dept.external_tasks} />
              <Mini label="Late" value={dept.overdue} bad={dept.overdue > 0} />
              <Mini label="Finished today" value={dept.closed_today} />
            </div>
          </div>
        </section>
      )}

      {/* ---------- everything else ---------- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">All work</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card to="/tasks/list?filter=raised" label="Raised by us" value={c?.raised_by_me}
            hint="Tasks you sent to others" />
          <Card to="/tasks/list?filter=progress" label="In progress" value={c?.in_progress} />
          <Card to="/tasks/list?filter=review" label="Awaiting review" value={c?.awaiting_review}
            hint="Done, waiting to be checked" />
          <Card to="/tasks/list?filter=closed" label="Closed" value={c?.closed} />
        </div>
      </section>

      {/* ---------- the other screens ---------- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Reports and setup</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {can('tasks.pfd') && (
            <Tile to="/tasks/pfd" label="Plan for the day"
              hint="What this department will do today" />
          )}
          <Tile to="/tasks/eod" label="End of day"
            hint="What actually happened, sent to the HOD group" />
          {can('tasks.schedules') && (
            <Tile to="/tasks/schedules" label="Recurring tasks"
              hint="Jobs that come round on their own"
              badge={c?.recurring_open} />
          )}
          {can('tasks.mrf') && (
            <Tile to="/tasks/manpower" label="Manpower"
              hint="Positions open and what HR did"
              badge={c?.manpower_open} />
          )}
          {can('tasks.reports') && (
            <Tile to="/tasks/departments" label="Departments"
              hint="Everything each department does" />
          )}
          {can('tasks.score') && (
            <Tile to="/tasks/score" label="Scores"
              hint="Out of ten, with strengths and what to fix" />
          )}
          {can('tasks.reports') && (
            <Tile to="/tasks/reports" label="Reports"
              hint="Raised against closed, register, end of day" />
          )}
          <Tile to="/tasks/list" label="Every task" hint="The full list, filterable" />
        </div>
      </section>

      {/* ---------- management only ---------- */}
      {org && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Across the company</h2>
            <Link to="/tasks/departments" className="text-sm text-slate2">By department</Link>
          </div>

          <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
            <Mini label="Plans submitted"
              value={`${org.pfd_submitted}/${org.depts_with_work}`}
              warn={org.pfd_submitted < org.depts_with_work} />
            <Mini label="Raised today" value={org.raised_today} />
            <Mini label="Finished today" value={org.closed_today} />
            <Mini label="Overdue" value={org.overdue} bad={org.overdue > 0} />
            <Mini label="Not accepted" value={org.unaccepted} warn={org.unaccepted > 0} />
            <Mini label="Disputed" value={org.disputes} bad={org.disputes > 0} />
          </div>

          {queue.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-slate2">
                Waiting on management
              </h3>
              <ul className="card divide-y divide-line">
                {queue.map(q => (
                  <li key={q.kind + q.task_id}>
                    <Link to={'/tasks/' + q.task_id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                      <span className={'tag shrink-0 ' + QUEUE_STYLE[q.kind]}>
                        {QUEUE_LABEL[q.kind]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{q.title}</span>
                        <span className="block truncate text-2xs text-slate2">
                          {q.department_name} · {q.detail}
                        </span>
                      </span>
                      <span className={'shrink-0 text-xs ' +
                        (q.days_waiting >= 3 ? 'font-semibold text-bad' : 'text-slate2')}>
                        {q.days_waiting}d
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

const QUEUE_LABEL = {
  dispute: 'Dispute', review: 'Check it',
  unaccepted: 'Not accepted', overdue: 'Late'
}
const QUEUE_STYLE = {
  dispute: 'bg-bad/10 text-bad', review: 'bg-good/15 text-good',
  unaccepted: 'bg-gold2 text-gold', overdue: 'bg-bad/10 text-bad'
}

/* ------------------------------------------------------------------ */

function Card({ to, label, value, hint, feature, tone }) {
  const tones = { bad: 'border-bad/30 bg-bad/[.04]', warn: 'border-warn/30 bg-warn/[.05]' }
  return (
    <Link to={to}
      className={'card block p-4 transition hover:border-mute ' +
        (feature ? 'border-ink bg-ink text-white ' : tones[tone] || '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className={'mt-1 text-2xl font-semibold tracking-tight ' +
        (tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : '')}>
        {value ?? 0}
      </div>
      {hint && (
        <div className={'mt-0.5 text-2xs ' + (feature ? 'text-white/60' : 'text-slate2')}>
          {hint}
        </div>
      )}
    </Link>
  )
}

function Tile({ to, label, hint, badge }) {
  return (
    <Link to={to} className="card block p-4 transition hover:border-mute">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{label}</div>
        {badge > 0 && (
          <span className="tag bg-ink/10 text-ink">{badge}</span>
        )}
      </div>
      {hint && <div className="mt-1 text-2xs text-slate2">{hint}</div>}
    </Link>
  )
}

function Mini({ label, value, bad, warn }) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={'text-lg font-semibold ' +
        (bad ? 'text-bad' : warn ? 'text-warn' : '')}>{value}</div>
    </div>
  )
}
