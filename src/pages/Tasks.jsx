import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db, dt, dtTime } from '../lib/db'
import { useMe } from '../App'

const STATUS_STYLE = {
  raised:       'bg-gold/15 text-gold',
  reissued:     'bg-bad/10 text-bad',
  acknowledged: 'bg-ink/10 text-ink',
  in_progress:  'bg-ink/10 text-ink',
  completed:    'bg-good/15 text-good',
  verified:     'bg-good/15 text-good',
  cancelled:    'bg-line text-slate2'
}

const LABEL = {
  raised: 'new', reissued: 'reissued', acknowledged: 'accepted',
  in_progress: 'in progress', completed: 'done, awaiting check',
  verified: 'closed', cancelled: 'cancelled'
}

const PRIORITY = {
  urgent: 'bg-bad text-white', high: 'bg-gold text-white',
  normal: '', low: ''
}

export default function Tasks() {
  const me = useMe()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('t') || 'inbox'
  const [rows, setRows] = useState([])
  const [myDepts, setMyDepts] = useState([])
  const [isMD, setIsMD] = useState(false)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])
  useEffect(() => { if (myDepts.length || isMD) load() }, [tab, myDepts, isMD])

  async function init() {
    const { data } = await db.from('department_members')
      .select('department_id, post, departments(code,is_md_office)')
      .eq('profile_id', me.id).eq('active', true)
    const list = data || []
    setMyDepts(list.map(d => d.department_id))
    setIsMD(list.some(d => d.departments?.is_md_office))
    if (!list.length) setLoading(false)
  }

  async function load() {
    setLoading(true)
    let sel = db.from('v_tasks').select('*').order('created_at', { ascending: false }).limit(300)

    if (tab === 'inbox')  sel = sel.in('to_dept', myDepts)
    if (tab === 'raised') sel = sel.in('from_dept', myDepts)
    if (tab === 'open')   sel = sel.not('status', 'in', '("verified","cancelled")')
    if (tab === 'late')   sel = sel.or('overdue.eq.true,ack_overdue.eq.true')

    const { data } = await sel
    setRows(data || []); setLoading(false)
  }

  const shown = q
    ? rows.filter(r => (r.title + r.task_no + r.from_dept_name + r.to_dept_name)
        .toLowerCase().includes(q.toLowerCase()))
    : rows

  const counts = {
    todo: rows.filter(r => ['raised', 'reissued'].includes(r.status)).length,
    check: rows.filter(r => r.status === 'completed').length,
    late: rows.filter(r => r.overdue || r.ack_overdue).length
  }

  const TABS = [
    ['inbox',  'For my department'],
    ['raised', 'We raised'],
    ...(isMD ? [['open', 'All open'], ['late', 'Late']] : [])
  ]

  if (!loading && myDepts.length === 0) {
    return (
      <div className="page page-sm">
        <div className="card p-8 text-center">
          <div className="text-sm font-bold">You are not in a department yet</div>
          <p className="mt-1 text-[13px] text-slate2">
            Tasks move between departments, so an admin needs to add you to one
            before you can raise or receive them.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page page-lg space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Tasks</h1>
          <p className="text-sm text-slate2">
            Work asked of one department by another.
          </p>
        </div>
        <Link to="/tasks/new" className="btn-gold shrink-0">Raise task</Link>
      </div>

      {(counts.todo > 0 || counts.check > 0 || counts.late > 0) && (
        <div className="card grid grid-cols-3 divide-x divide-line">
          <Stat label="To accept" value={counts.todo} warn={counts.todo > 0} />
          <Stat label="To check" value={counts.check} />
          <Stat label="Late" value={counts.late} bad={counts.late > 0} />
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setSp({ t: k })}
            className={'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (tab === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {label}
          </button>
        ))}
      </div>

      <input value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search title, number or department" />

      {loading ? <div className="py-10 text-center text-sm text-slate2">Loading</div>
        : shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          Nothing here.
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {shown.map(t => (
            <li key={t.id}>
              <Link to={'/tasks/' + t.id} className="block px-4 py-3 hover:bg-paper">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{t.title}</span>
                      {t.priority !== 'normal' && (
                        <span className={'tag ' + (PRIORITY[t.priority] || '')}>
                          {t.priority}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate2">
                      <span className="font-mono">{t.task_no}</span>
                      {' · '}{t.from_dept_code} → {t.to_dept_code}
                      {' · '}{t.raised_by_name}
                      {t.attachments > 0 && ` · ${t.attachments} attached`}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                      {t.due_date && (
                        <span className={t.overdue ? 'font-semibold text-bad' : 'text-slate2'}>
                          due {dt(t.due_date)}
                        </span>
                      )}
                      {t.ack_overdue && (
                        <span className="font-semibold text-bad">not accepted in 24h</span>
                      )}
                      {t.reissue_count > 0 && (
                        <span className="font-semibold text-gold">
                          reissued {t.reissue_count}×
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={'tag shrink-0 ' + (STATUS_STYLE[t.status] || '')}>
                    {LABEL[t.status]}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, warn, bad }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className={'text-xl font-bold ' + (bad ? 'text-bad' : warn ? 'text-gold' : '')}>
        {value}
      </div>
    </div>
  )
}
