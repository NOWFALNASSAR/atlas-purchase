import { useEffect, useMemo, useState } from 'react'
import { db, lakh, inr, dt, num } from '../lib/db'
import { useMe, useEntity } from '../App'

/* ==================================================================
   PURCHASE TARGETS

   §33 is the whole point of this screen: only MD Office may move a
   target, a reason is required, and every change is kept. A target
   that can be quietly lowered on the 28th is not a target.

   Everyone else sees the same figures and cannot change them. The
   database enforces that, not the buttons.
   ================================================================== */

export default function Targets() {
  const me = useMe()
  const { entityId, entities } = useEntity()

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [rows, setRows] = useState([])
  const [history, setHistory] = useState([])
  const [isMd, setIsMd] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('type')

  useEffect(() => { boot() }, [])
  useEffect(() => { load() }, [month, entityId])

  async function boot() {
    const { data } = await db.from('department_members')
      .select('departments(is_md_office)').eq('profile_id', me.id).eq('active', true)
    setIsMd((data || []).some(d => d.departments?.is_md_office))
  }

  async function load() {
    setLoading(true)
    const period = month + '-01'
    const [a, h] = await Promise.all([
      db.rpc('purchase_achievement', {
        p_period: period,
        p_entity: entityId && entityId !== 'mixed' ? entityId : null
      }),
      db.from('purchase_target_history').select('*')
        .order('created_at', { ascending: false }).limit(30)
    ])
    if (a.error) { setFailed(a.error.message); setLoading(false); return }
    setRows(a.data || [])
    setHistory(h.data || [])
    setFailed(null)
    setLoading(false)
  }

  async function save() {
    if (!edit.reason?.trim()) return alert('Say why this target is being set or changed')
    setBusy(true)
    const { error } = await db.rpc('set_purchase_target', {
      p_period: month + '-01',
      p_scope: edit.scope,
      p_type: edit.scope === 'type' ? edit.ref : null,
      p_purchaser: edit.scope === 'purchaser' ? edit.ref : null,
      p_entity: entityId && entityId !== 'mixed' ? entityId : null,
      p_amount: Number(edit.amount) || 0,
      p_reason: edit.reason.trim()
    })
    setBusy(false)
    if (error) return alert(error.message)
    setEdit(null)
    load()
  }

  const shown = useMemo(() => rows.filter(r => r.scope === tab), [rows, tab])

  const totals = useMemo(() => shown.reduce((s, r) => ({
    target: s.target + Number(r.target || 0),
    achieved: s.achieved + Number(r.achieved || 0),
    orders: s.orders + Number(r.orders || 0)
  }), { target: 0, achieved: 0, orders: 0 }), [shown])

  const overall = totals.target > 0 ? (totals.achieved / totals.target) * 100 : null

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load targets</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions purchase_achievement, run
          supabase/37_purchase_targets.sql in Supabase.
        </p>
      </div>
    </div>
  )

  return (
    <div className="page page-xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Purchase targets</h1>
          <p className="text-sm text-slate2">
            {isMd
              ? 'You can set targets. Every change is kept with your reason.'
              : 'Set by MD Office. You can see them but not change them.'}
          </p>
        </div>
        <input type="month" className="!w-auto" value={month}
          onChange={e => setMonth(e.target.value)} />
      </div>

      {entities.length > 1 && entityId === 'mixed' && (
        <div className="rounded-md bg-paper px-3 py-2 text-xs text-slate2">
          Showing all entities together. Pick one at the top of the screen to set a
          target for that entity alone.
        </div>
      )}

      <div className="card grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
        <Cell label="Target" value={lakh(totals.target)} />
        <Cell label="Achieved" value={lakh(totals.achieved)} feature />
        <Cell label="Balance"
          value={lakh(Math.max(totals.target - totals.achieved, 0))} />
        <Cell label="Achievement"
          value={overall == null ? '—' : num(overall, 1) + '%'}
          tone={overall == null ? null : overall >= 90 ? 'good' : overall >= 70 ? 'warn' : 'bad'} />
      </div>

      {overall != null && (
        <div className="card p-4">
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="text-slate2">
              {lakh(totals.achieved)} of {lakh(totals.target)}
            </span>
            <span className="font-semibold">{num(overall, 1)}%</span>
          </div>
          <div className="h-2 rounded-full bg-line2">
            <div className={'h-2 rounded-full ' +
              (overall >= 90 ? 'bg-good' : overall >= 70 ? 'bg-warn' : 'bg-bad')}
              style={{ width: Math.min(overall, 100) + '%' }} />
          </div>
        </div>
      )}

      <div className="flex gap-1 rounded-md bg-paper p-1">
        {[['type', 'By purchase type'], ['purchaser', 'By purchaser']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'flex-1 rounded px-3 py-1.5 text-sm font-semibold ' +
              (tab === k ? 'bg-white text-ink shadow-card' : 'text-slate2')}>
            {l}
          </button>
        ))}
      </div>

      {loading ? <div className="card h-64 animate-pulse bg-line2" />
        : shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          {tab === 'purchaser'
            ? 'No purchasers yet. Anyone who raises an order becomes one automatically.'
            : 'No purchase types set up.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-2.5 text-left">
                  {tab === 'type' ? 'Purchase type' : 'Purchaser'}
                </th>
                <th className="px-3 py-2.5 text-right">Target</th>
                <th className="px-3 py-2.5 text-right">Achieved</th>
                <th className="px-3 py-2.5 text-right">Balance</th>
                <th className="px-3 py-2.5 text-right">Orders</th>
                <th className="px-4 py-2.5 text-right">%</th>
                {isMd && <th className="px-4 py-2.5 text-right">Set</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.scope + r.ref} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-3 py-3 text-right">
                    {Number(r.target) > 0 ? inr(r.target)
                      : <span className="text-2xs text-slate2">not set</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold">{inr(r.achieved)}</td>
                  <td className="px-3 py-3 text-right text-slate2">
                    {Number(r.target) > 0 ? inr(r.balance) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-slate2">{r.orders}</td>
                  <td className="px-4 py-3 text-right">
                    {r.pct == null ? '—' : (
                      <span className={'tag ' + (r.pct >= 90 ? 'bg-good/15 text-good'
                        : r.pct >= 70 ? 'bg-warn/15 text-warn' : 'bg-bad/10 text-bad')}>
                        {num(r.pct, 1)}%
                      </span>
                    )}
                  </td>
                  {isMd && (
                    <td className="px-4 py-3 text-right">
                      <button className="text-xs font-semibold text-gold"
                        onClick={() => setEdit({
                          scope: r.scope, ref: r.ref, name: r.name,
                          amount: Number(r.target) || '', reason: ''
                        })}>
                        {Number(r.target) > 0 ? 'Change' : 'Set'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- the audit trail ---------- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Every target change</h2>
        {history.length === 0 ? (
          <div className="card p-5 text-sm text-slate2">No target has been set yet.</div>
        ) : (
          <ul className="card divide-y divide-line">
            {history.map(h => (
              <li key={h.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold">{h.subject}</span>
                  <span className={'tag ' +
                    (h.direction === 'increased' ? 'bg-good/15 text-good'
                     : h.direction === 'reduced' ? 'bg-bad/10 text-bad'
                     : 'bg-line text-slate2')}>
                    {h.direction}
                  </span>
                  <span className="text-sm">
                    {h.old_amount != null && (
                      <span className="text-slate2 line-through">{inr(h.old_amount)}</span>
                    )}
                    {h.old_amount != null && ' → '}
                    <strong>{inr(h.new_amount)}</strong>
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate2">{h.reason}</div>
                <div className="mt-0.5 text-2xs text-mute">
                  {h.actor_name || 'MD Office'} · {dt(h.created_at)}
                  {' · for '}{new Date(h.period).toLocaleDateString('en-IN',
                    { month: 'long', year: 'numeric' })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
          onClick={() => setEdit(null)}>
          <div className="safe-b w-full max-w-md rounded-t-xl bg-white p-5 shadow-pop md:rounded-xl"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold">{edit.name}</h2>
            <p className="mb-4 text-xs text-slate2">
              Target for {new Date(month + '-01').toLocaleDateString('en-IN',
                { month: 'long', year: 'numeric' })}
              {entityId && entityId !== 'mixed' &&
                ' · ' + (entities.find(e => e.id === entityId)?.name || '')}
            </p>

            <div className="space-y-3">
              <div>
                <label>Target amount ₹</label>
                <input type="number" inputMode="numeric" value={edit.amount}
                  onChange={e => setEdit(v => ({ ...v, amount: e.target.value }))} />
                {Number(edit.amount) > 0 && (
                  <p className="mt-1 text-2xs text-slate2">{lakh(edit.amount)}</p>
                )}
              </div>
              <div>
                <label>Reason *</label>
                <textarea rows={2} value={edit.reason}
                  placeholder="Increased for the festival season"
                  onChange={e => setEdit(v => ({ ...v, reason: e.target.value }))} />
                <p className="mt-1 text-2xs text-slate2">
                  Kept permanently, with your name and the old figure.
                </p>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button className="btn-dark flex-1" disabled={busy} onClick={save}>
                {busy ? 'Saving' : 'Set target'}
              </button>
              <button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Cell({ label, value, feature, tone }) {
  const tones = { good: 'text-good', warn: 'text-warn', bad: 'text-bad' }
  return (
    <div className={'px-4 py-3 ' + (feature ? 'bg-ink text-white' : '')}>
      <div className={'stat-label ' + (feature ? 'text-white/60' : '')}>{label}</div>
      <div className={'text-xl font-semibold ' + (tones[tone] || '')}>{value}</div>
    </div>
  )
}
