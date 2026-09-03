import { useEffect, useState } from 'react'
import { db, inr, lakh, dt } from '../lib/db'
import { useMe } from '../App'
import { Modal } from './Suppliers'

/**
 * Targets are entered here and never come from the billing software.
 * A change never overwrites — it inserts a new row and marks the old
 * one superseded, so you keep the history of what was agreed and when.
 */
export default function Targets() {
  const me = useMe()
  const [branches, setBranches] = useState([])
  const [targets, setTargets] = useState([])
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [edit, setEdit] = useState(null)
  const [bulk, setBulk] = useState(false)
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(true)

  const canEdit = ['hod', 'admin'].includes(me.role)

  useEffect(() => { load() }, [month])

  const start = month + '-01'
  const end = new Date(new Date(start).getFullYear(),
                       new Date(start).getMonth() + 1, 0).toISOString().slice(0, 10)

  async function load() {
    setLoading(true)
    const [b, t] = await Promise.all([
      db.from('branches').select('*').eq('active', true).order('code'),
      db.from('targets').select('*')
        .eq('scope', 'branch').is('superseded_by', null)
        .lte('period_start', end).gte('period_end', start)
    ])
    setBranches(b.data || []); setTargets(t.data || []); setLoading(false)
  }

  const targetFor = id => targets.find(t => t.branch_id === id)

  async function save(branchId, amount, note) {
    const value = Number(amount)
    if (!value || value <= 0) return alert('Enter an amount')

    const existing = targetFor(branchId)
    const { data: created, error } = await db.from('targets').insert({
      scope: 'branch', branch_id: branchId,
      period_start: start, period_end: end,
      amount: value, note: note || null, created_by: me.id
    }).select().single()
    if (error) return alert(error.message)

    // keep the old one as history rather than deleting it
    if (existing) {
      await db.from('targets').update({ superseded_by: created.id }).eq('id', existing.id)
    }
    setEdit(null); load()
  }

  async function saveBulk(rows) {
    for (const r of rows) {
      if (Number(r.amount) > 0) await save(r.branch_id, r.amount, 'Bulk entry')
    }
    setBulk(false); load()
  }

  async function showHistory(branchId) {
    const { data } = await db.from('targets').select('*')
      .eq('scope', 'branch').eq('branch_id', branchId)
      .order('created_at', { ascending: false }).limit(20)
    setHistory({ branchId, rows: data || [] })
  }

  const total = branches.reduce((s, b) => s + Number(targetFor(b.id)?.amount || 0), 0)
  const missing = branches.filter(b => !targetFor(b.id)).length

  return (
    <div className="page page-lg space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Targets</h1>
          <p className="text-sm text-slate2">
            Monthly sales target per branch. Achievement is measured against these.
          </p>
        </div>
        {canEdit && branches.length > 0 && (
          <button className="btn-gold shrink-0" onClick={() => setBulk(true)}>Set all</button>
        )}
      </div>

      <div className="card grid grid-cols-3 divide-x divide-line">
        <div className="px-4 py-3">
          <label>Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
        <Stat label="Total target" value={lakh(total)} />
        <Stat label="Not set" value={missing} warn={missing > 0} />
      </div>

      {!canEdit && (
        <p className="text-[13px] text-slate2">
          Only the HOD and admin can change targets. You can see them here.
        </p>
      )}

      {loading ? <div className="py-10 text-center text-sm text-slate2">Loading</div>
        : branches.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          No branches yet. Add them in Settings first.
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {branches.map(b => {
            const t = targetFor(b.id)
            return (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{b.name}</div>
                  <div className="text-[11px] text-slate2">
                    <span className="font-mono">{b.code}</span>
                    {t?.note && ' · ' + t.note}
                    {t && ' · set ' + dt(t.created_at)}
                  </div>
                </div>

                <div className="text-right">
                  {t ? (
                    <div className="text-base font-bold">{lakh(t.amount)}</div>
                  ) : (
                    <div className="text-[13px] text-slate2">not set</div>
                  )}
                </div>

                {canEdit && (
                  <button className="btn-ghost !px-3 !py-1.5 !text-xs"
                    onClick={() => setEdit({ branch: b, amount: t?.amount || '', note: '' })}>
                    {t ? 'Change' : 'Set'}
                  </button>
                )}
                <button className="text-xs text-slate2 underline"
                  onClick={() => showHistory(b.id)}>History</button>
              </li>
            )
          })}
        </ul>
      )}

      {/* single edit */}
      {edit && (
        <Modal title={`Target for ${edit.branch.name}`} onClose={() => setEdit(null)}>
          <div className="space-y-3">
            <div>
              <label>Month</label>
              <div className="rounded-md border border-line bg-paper px-3 py-2 text-[15px]">
                {new Date(start).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </div>
            </div>
            <div>
              <label>Target amount ₹</label>
              <input type="number" inputMode="numeric" autoFocus value={edit.amount}
                onChange={e => setEdit(v => ({ ...v, amount: e.target.value }))}
                placeholder="e.g. 5000000" />
              {Number(edit.amount) > 0 && (
                <p className="mt-1 text-[13px] font-semibold">{lakh(edit.amount)}</p>
              )}
            </div>
            <div>
              <label>Note (optional)</label>
              <input value={edit.note} placeholder="Onam month / revised after review"
                onChange={e => setEdit(v => ({ ...v, note: e.target.value }))} />
            </div>
          </div>
          <button className="btn-dark mt-4 w-full"
            onClick={() => save(edit.branch.id, edit.amount, edit.note)}>
            Save target
          </button>
          <p className="mt-2 text-center text-[11px] text-slate2">
            The previous target is kept as history, not overwritten.
          </p>
        </Modal>
      )}

      {/* bulk */}
      {bulk && (
        <BulkTargets branches={branches} targetFor={targetFor}
          month={new Date(start).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          onCancel={() => setBulk(false)} onSave={saveBulk} />
      )}

      {/* history */}
      {history && (
        <Modal title="Target history" onClose={() => setHistory(null)}>
          {history.rows.length === 0 ? (
            <p className="text-sm text-slate2">Nothing set yet for this branch.</p>
          ) : (
            <ol className="space-y-2">
              {history.rows.map(h => (
                <li key={h.id} className="flex items-start gap-3 border-b border-line pb-2 text-[13px]">
                  <span className="flex-1">
                    <span className="font-semibold">{lakh(h.amount)}</span>
                    <span className="text-slate2">
                      {' '}for {dt(h.period_start)} – {dt(h.period_end)}
                    </span>
                    {h.note && <span className="block text-[11px] text-slate2">{h.note}</span>}
                  </span>
                  <span className="text-[11px] text-slate2">
                    {dt(h.created_at)}
                    {h.superseded_by && <span className="block text-gold">replaced</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Modal>
      )}
    </div>
  )
}

function BulkTargets({ branches, targetFor, month, onCancel, onSave }) {
  const [rows, setRows] = useState(
    branches.map(b => ({ branch_id: b.id, name: b.name, code: b.code,
                         amount: targetFor(b.id)?.amount || '' })))

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0)

  return (
    <Modal title={`Set targets — ${month}`} onClose={onCancel}>
      <ul className="mb-3 space-y-2">
        {rows.map((r, i) => (
          <li key={r.branch_id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px]">
              <span className="font-mono text-[11px] text-slate2">{r.code}</span> {r.name}
            </span>
            <input type="number" inputMode="numeric" value={r.amount}
              className="!w-32 !py-1 text-right !text-[13px]"
              onChange={e => setRows(v => v.map((x, j) =>
                j === i ? { ...x, amount: e.target.value } : x))} />
          </li>
        ))}
      </ul>

      <div className="mb-3 flex justify-between rounded-md bg-paper px-3 py-2 text-sm">
        <span className="text-slate2">Total</span>
        <span className="font-bold">{lakh(total)}</span>
      </div>

      <button className="btn-dark w-full" onClick={() => onSave(rows)}>
        Save all targets
      </button>
    </Modal>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className={'text-lg font-bold ' + (warn ? 'text-gold' : '')}>{value}</div>
    </div>
  )
}
