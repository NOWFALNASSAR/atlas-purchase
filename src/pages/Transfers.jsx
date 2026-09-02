import { useEffect, useState } from 'react'
import { db, inr, lakh, dt } from '../lib/db'

/**
 * Head office dispatch against branch receipt.
 * Two servers, two sets of numbers, compared for the first time.
 */
export default function Transfers() {
  const [tab, setTab] = useState('transit')
  const [docs, setDocs] = useState([])
  const [byBranch, setByBranch] = useState([])
  const [byItem, setByItem] = useState([])
  const [open, setOpen] = useState(null)
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [d, b, i] = await Promise.all([
      db.from('v_transfer_docs').select('*').order('doc_date', { ascending: false }).limit(300),
      db.from('v_transfer_variance_by_branch').select('*'),
      db.from('v_transfer_variance_by_item').select('*').limit(30)
    ])
    setDocs(d.data || []); setByBranch(b.data || []); setByItem(i.data || [])
    setLoading(false)
  }

  async function openDoc(doc) {
    setOpen(doc)
    const { data } = await db.from('v_transfer_lines').select('*').eq('doc_no', doc.doc_no)
    setLines(data || [])
  }

  const transit = docs.filter(d => d.status !== 'matched')
  const shown = tab === 'transit' ? transit : docs

  const totalDiff = byBranch.reduce((s, b) => s + Number(b.value_difference || 0), 0)
  const notReceived = docs.filter(d => d.status === 'not received').length

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Transfers</h1>
        <p className="text-sm text-slate2">
          What head office sent, against what the branch recorded as received.
        </p>
      </div>

      <div className="card grid grid-cols-3 divide-x divide-line">
        <Stat label="Open documents" value={transit.length} warn={transit.length > 0} />
        <Stat label="Not acknowledged" value={notReceived} warn={notReceived > 0} />
        <Stat label="Value difference" value={lakh(Math.abs(totalDiff))} warn={totalDiff !== 0} />
      </div>

      {docs.length === 0 && !loading && (
        <div className="card p-8 text-center text-sm text-slate2">
          No transfer data yet. This fills in once the branch agents start syncing.
        </div>
      )}

      {byBranch.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-4 py-3 text-sm font-bold">Variance by branch, last 90 days</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-4 py-2 text-left">Branch</th>
                  <th className="px-3 py-2 text-right">Sent</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">Diff</th>
                  <th className="px-4 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {byBranch.map(b => (
                  <tr key={b.branch} className="border-t border-line">
                    <td className="px-4 py-2.5 font-medium">{b.branch}</td>
                    <td className="px-3 py-2.5 text-right">{b.sent}</td>
                    <td className="px-3 py-2.5 text-right">{b.received}</td>
                    <td className={'px-3 py-2.5 text-right font-semibold ' +
                      (b.difference < 0 ? 'text-bad' : b.difference > 0 ? 'text-gold' : '')}>
                      {b.difference > 0 ? '+' : ''}{b.difference}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {b.value_difference ? inr(b.value_difference) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-[11px] text-slate2">
            A branch consistently short by 2–3% is worth a conversation. One that
            is short on high-value items only is worth a closer look.
          </p>
        </section>
      )}

      <div className="flex gap-1">
        {[['transit', `Needs attention (${transit.length})`], ['all', 'All documents']]
          .map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (tab === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <div className="py-10 text-center text-sm text-slate2">Loading</div> : (
        <ul className="card divide-y divide-line">
          {shown.map(d => (
            <li key={d.doc_no}>
              <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper"
                onClick={() => openDoc(d)}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {d.from_branch || 'Godown'} → {d.to_branch || d.to_location || '—'}
                  </div>
                  <div className="font-mono text-[11px] text-slate2">
                    {d.doc_no} · {dt(d.doc_date)} · {d.lines} items
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">
                    {d.sent} → {d.received}
                  </div>
                  {d.difference !== 0 && (
                    <div className={'text-[11px] font-semibold ' +
                      (d.difference < 0 ? 'text-bad' : 'text-gold')}>
                      {d.difference > 0 ? '+' : ''}{d.difference} pcs
                    </div>
                  )}
                </div>
                <span className={'tag ' +
                  (d.status === 'matched' ? 'bg-good/15 text-good'
                    : d.status === 'not received' ? 'bg-bad/10 text-bad'
                    : 'bg-gold/15 text-gold')}>
                  {d.status}
                </span>
              </button>
            </li>
          ))}
          {!loading && shown.length === 0 && (
            <li className="p-8 text-center text-sm text-slate2">
              Everything sent has been received and matches.
            </li>
          )}
        </ul>
      )}

      {byItem.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-4 py-3 text-sm font-bold">Items that go missing most</div>
          <ul className="divide-y divide-line">
            {byItem.map(i => (
              <li key={i.item_code} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">
                  {i.item_name}
                  <span className="block font-mono text-[11px] text-slate2">{i.item_code}</span>
                </span>
                <span className="text-right">
                  <span className="block text-slate2">{i.sent} sent · {i.received} received</span>
                  <span className={'block font-semibold ' +
                    (i.difference < 0 ? 'text-bad' : 'text-gold')}>
                    {i.difference > 0 ? '+' : ''}{i.difference} pcs · {inr(Math.abs(i.value_difference))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
             onClick={() => setOpen(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white md:rounded-xl"
               onClick={e => e.stopPropagation()}>
            <div className="border-b border-line p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-sm font-bold">{open.doc_no}</div>
                  <div className="text-[12px] text-slate2">
                    {open.from_branch || 'Godown'} → {open.to_branch || open.to_location} · {dt(open.doc_date)}
                  </div>
                </div>
                <button onClick={() => setOpen(null)} className="text-sm text-slate2">Close</button>
              </div>
            </div>
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-4 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Sent</th>
                  <th className="px-3 py-2 text-right">Got</th>
                  <th className="px-4 py-2 text-right">Diff</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-2">
                      {l.item_name}
                      <span className="block font-mono text-[10px] text-slate2">{l.item_code}</span>
                    </td>
                    <td className="px-3 py-2 text-right">{l.qty_sent}</td>
                    <td className="px-3 py-2 text-right">{l.qty_received}</td>
                    <td className={'px-4 py-2 text-right font-semibold ' +
                      (l.difference < 0 ? 'text-bad' : l.difference > 0 ? 'text-gold' : 'text-slate2')}>
                      {l.difference === 0 ? '✓' : (l.difference > 0 ? '+' : '') + l.difference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className={'text-xl font-bold ' + (warn ? 'text-gold' : '')}>{value}</div>
    </div>
  )
}
