import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, inr, lakh, dt } from '../lib/db'
import { useEntity } from '../App'

/**
 * Two things happen here.
 *
 * 1. Warnings are worked out in SQL — rate rises, thin margins, godown
 *    pile-up, approvals sitting too long. Rules, not guesses, so the
 *    numbers can be trusted and checked.
 *
 * 2. "Copy for Claude" puts a compact summary on the clipboard. Paste it
 *    into the Claude app and ask what you like. Only aggregates leave —
 *    no supplier phone numbers, no photos, no staff details.
 */
export default function Insights() {
  const { entityId, entities } = useEntity()
  const [d, setD] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [month, rate, marginA, godown, pending, share] = await Promise.all([
      db.from('v_ai_month_summary').select('*'),
      db.from('v_ai_rate_alerts').select('*').limit(10),
      db.from('v_ai_margin_alerts').select('*').limit(10),
      db.from('v_ai_godown_alerts').select('*').limit(10),
      db.from('v_ai_pending_alerts').select('*').limit(20),
      db.from('v_ai_supplier_share').select('*').limit(10)
    ])
    setD({
      month: month.data || [], rate: rate.data || [], margin: marginA.data || [],
      godown: godown.data || [], pending: pending.data || [], share: share.data || []
    })
  }

  if (!d) return <div className="py-16 text-center text-sm text-slate2">Working through your data</div>

  const monthValue = d.month.reduce((s, r) => s + Number(r.purchase_value), 0)
  const stale = d.pending.filter(p => p.days_waiting >= 3)
  const godownValue = d.godown.reduce((s, r) => s + Number(r.value_stuck), 0)
  const rateExtra = d.rate.reduce((s, r) => s + Number(r.extra_cost || 0), 0)
  const topShare = d.share[0]

  const alerts = []
  if (stale.length)
    alerts.push({ level: 'bad', title: `${stale.length} orders waiting more than 3 days for approval`,
      detail: `${inr(stale.reduce((s, p) => s + Number(p.total_purchase), 0))} held up. Oldest: ${stale[0].po_no}, ${stale[0].days_waiting} days with the ${stale[0].pending_role}.`,
      to: '/orders?filter=pending' })
  if (rateExtra > 0)
    alerts.push({ level: 'warn', title: `Rates rose on ${d.rate.length} items`,
      detail: `About ${inr(rateExtra)} more than the last purchase of the same items. Biggest: ${d.rate[0].item_name}, up ${d.rate[0].increase_pct}%.`,
      to: '/compare' })
  if (godownValue > 0)
    alerts.push({ level: 'warn', title: `${inr(godownValue)} sitting in the godown`,
      detail: `${d.godown.length} items bought over two weeks ago and not sent to any shop. Oldest: ${d.godown[0].item_name}, ${d.godown[0].days_old} days.`,
      to: '/reports' })
  if (d.margin.length)
    alerts.push({ level: 'warn', title: `${d.margin.length} items bought below 25% margin`,
      detail: `Lowest: ${d.margin[0].item_name} at ${d.margin[0].margin_pct}% from ${d.margin[0].supplier}.` })
  if (topShare && topShare.share_pct > 30)
    alerts.push({ level: 'info', title: `${topShare.supplier} is ${topShare.share_pct}% of your buying`,
      detail: `${inr(topShare.value)} over 90 days. Worth knowing how exposed you are if they raise rates.` })

  function copyForClaude() {
    const t = [
      `ATLAS MAHARANI — PURCHASE DATA, ${new Date().toLocaleDateString('en-IN')}`,
      '',
      'THIS MONTH BY ENTITY AND TYPE',
      ...d.month.map(r =>
        `${r.entity} | ${r.purchase_type || 'no type'} | ${r.orders} orders | ${r.pieces} pcs | ₹${Number(r.purchase_value).toFixed(0)} | margin ${r.margin_pct}%`),
      '',
      'RATE INCREASES (same item, last two purchases)',
      ...d.rate.map(r =>
        `${r.item_name}: ₹${r.before_rate} (${r.before_supplier}) → ₹${r.now_rate} (${r.now_supplier}), +${r.increase_pct}%, extra ₹${r.extra_cost}`),
      '',
      'ITEMS UNDER 25% MARGIN',
      ...d.margin.map(r =>
        `${r.item_name}: bought ₹${r.purchase_rate}, selling ₹${r.selling_rate}, ${r.margin_pct}%, ${r.qty} pcs from ${r.supplier}`),
      '',
      'STOCK STILL IN GODOWN OVER 14 DAYS',
      ...d.godown.map(r =>
        `${r.item_name}: ${r.in_godown} pcs, ₹${r.value_stuck}, ${r.days_old} days old (${r.po_no})`),
      '',
      'ORDERS AWAITING APPROVAL',
      ...d.pending.map(r =>
        `${r.po_no} ${r.entity}: ₹${Number(r.total_purchase).toFixed(0)} with ${r.pending_role}, ${r.days_waiting} days`),
      '',
      'TOP SUPPLIERS, LAST 90 DAYS',
      ...d.share.map(r =>
        `${r.supplier}: ₹${Number(r.value).toFixed(0)}, ${r.share_pct}% of spend, ${r.orders} orders`),
      '',
      'Business: multi-entity textile retail, Kerala. 24 showrooms, one premium wedding centre.',
      'Please review this purchase data. What should I be worried about, what is going well,',
      'and what are the three most useful actions this week?'
    ].join('\n')

    navigator.clipboard.writeText(t)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 4000) })
      .catch(() => alert('Could not copy. Select the text manually from the box below.'))
  }

  return (
    <div className="page page-lg space-y-5">
      <div>
        <h1 className="text-xl font-bold">Insights</h1>
        <p className="text-sm text-slate2">
          Worked out from your approved orders. Every figure can be traced back.
        </p>
      </div>

      <div className="card grid grid-cols-2 divide-x divide-line md:grid-cols-4">
        <Stat label="Bought this month" value={lakh(monthValue)} />
        <Stat label="Awaiting approval" value={d.pending.length} warn={stale.length > 0} />
        <Stat label="Stuck in godown" value={lakh(godownValue)} warn={godownValue > 0} />
        <Stat label="Rate rises" value={d.rate.length} warn={d.rate.length > 0} />
      </div>

      {alerts.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          Nothing needs attention. Alerts appear once you have approved orders to compare.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li key={i} className={'card border-l-4 p-4 ' +
              (a.level === 'bad' ? 'border-l-bad' : a.level === 'warn' ? 'border-l-gold' : 'border-l-ink')}>
              <div className="text-sm font-bold">{a.title}</div>
              <div className="mt-1 text-[13px] text-slate2">{a.detail}</div>
              {a.to && <Link to={a.to} className="mt-2 inline-block text-xs font-semibold text-gold underline">
                Look at these
              </Link>}
            </li>
          ))}
        </ul>
      )}

      <section className="card p-4">
        <h2 className="text-sm font-bold">Ask Claude about this data</h2>
        <p className="mt-1 text-[13px] text-slate2">
          Copies a summary of the figures above. Paste it into the Claude app and
          ask whatever you want — where you are overpaying, which supplier to push
          on rates, what to watch this week.
        </p>
        <button className="btn-dark mt-3 w-full" onClick={copyForClaude}>
          {copied ? 'Copied — now paste it into Claude' : 'Copy summary for Claude'}
        </button>
        <p className="mt-2 text-[11px] text-slate2">
          Only totals and item names are copied. No supplier contact details, no
          photos, no staff information.
        </p>
      </section>

      {d.rate.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-4 py-3 text-sm font-bold">Items costing more than last time</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
                <tr>
                  <th className="px-4 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Was</th>
                  <th className="px-3 py-2 text-right">Now</th>
                  <th className="px-3 py-2 text-right">Up</th>
                  <th className="px-4 py-2 text-right">Extra cost</th>
                </tr>
              </thead>
              <tbody>
                {d.rate.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-2">
                      {r.item_name}
                      <span className="block text-[11px] text-slate2">
                        {r.before_supplier} → {r.now_supplier}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate2">{inr(r.before_rate)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{inr(r.now_rate)}</td>
                    <td className="px-3 py-2 text-right text-bad">+{r.increase_pct}%</td>
                    <td className="px-4 py-2 text-right">{inr(r.extra_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.godown.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-4 py-3 text-sm font-bold">Bought but not sent to any shop</div>
          <ul className="divide-y divide-line">
            {d.godown.map((g, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">
                  {g.item_name}
                  <span className="block text-[11px] text-slate2">{g.po_no} · {dt(g.created_at)}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold">{g.in_godown} pcs</span>
                  <span className="block text-[11px] text-slate2">{inr(g.value_stuck)}</span>
                </span>
                <span className="w-16 text-right text-[11px] text-gold">{g.days_old} days</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className={'text-xl font-bold ' + (warn ? 'text-gold' : '')}>{value}</div>
    </div>
  )
}
