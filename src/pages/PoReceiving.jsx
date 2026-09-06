import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, inr, dt, num } from '../lib/db'

/* ==================================================================
   GOODS RECEIVED

   Stock arriving tells a purchase order it was received. The bridge
   runs one way only — nothing here ever changes stock, and nothing in
   the stock upload ever changes a purchase order without someone
   agreeing to it here.

   The match is automatic. The confirmation is not, and deliberately
   so: there is no shared key between the billing system and an Atlas
   PO, so matching is done on supplier, item, date and quantity. Two
   orders to the same supplier for the same item a week apart look
   identical to that. Closing the wrong one leaves the other open
   forever with nobody knowing why.

   So the system does the looking and a person does the deciding.
   ================================================================== */

export default function PoReceiving() {
  const [orders, setOrders] = useState([])
  const [open, setOpen] = useState(null)
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  const [minConf, setMinConf] = useState(60)

  useEffect(() => { load() }, [])
  useEffect(() => { if (open) loadLines(open.po_id) }, [open?.po_id, minConf])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  async function load() {
    setLoading(true)
    const { data, error } = await db.from('v_po_awaiting_receipt')
      .select('*').order('latest_arrival', { ascending: false })
    if (error) { setFailed(error.message); setLoading(false); return }
    setOrders(data || [])
    setLoading(false)
  }

  async function loadLines(poId) {
    const { data } = await db.from('v_po_receipt_suggestions')
      .select('*').eq('po_id', poId)
      .gte('confidence', minConf)
      .order('confidence', { ascending: false })
    setLines(data || [])
  }

  async function confirm(r) {
    setBusy(r.barcode + r.po_item_id)
    const { error } = await db.rpc('receive_po_line', {
      p_po_item: r.po_item_id, p_barcode: r.barcode, p_ref: r.purchase_ref,
      p_qty: Math.min(Number(r.qty_arrived), Number(r.qty_ordered) - Number(r.qty_already_received || 0)),
      p_rate: r.rate_arrived, p_note: null
    })
    setBusy(null)
    if (error) return setNotice(error.message)
    setNotice(`${r.ordered_item} marked received.`)
    loadLines(open.po_id)
    load()
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions v_po_awaiting_receipt, run supabase/56_po_receiving.sql.
        </p>
      </div>
    </div>
  )

  /* ---------- one order ---------- */

  if (open) return (
    <div className="page page-lg space-y-4">
      <button onClick={() => { setOpen(null); setLines([]) }}
        className="text-sm font-medium text-slate2">
        All orders waiting
      </button>

      <div className="card p-4">
        <div className="text-base font-semibold">{open.po_no}</div>
        <div className="mt-0.5 text-xs text-slate2">
          {open.supplier_name} · ordered {dt(open.ordered_on)} ·
          {' '}{open.lines_matched} line{open.lines_matched === 1 ? '' : 's'} matched
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate2">Show matches at least</span>
        {[80, 60, 40].map(c => (
          <button key={c} onClick={() => setMinConf(c)}
            className={'rounded-md px-2.5 py-1 text-xs font-semibold ' +
              (minConf === c ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {c}% sure
          </button>
        ))}
      </div>

      {lines.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          Nothing at that confidence. Try a lower one.
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {lines.map(r => {
            const short = Number(r.qty_arrived) < Number(r.qty_ordered)
            const rateUp = r.rate_diff_pct != null && Number(r.rate_diff_pct) > 0
            return (
              <li key={r.po_item_id + r.barcode} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.ordered_item}</div>
                    <div className="mt-0.5 text-2xs text-slate2">
                      barcode {r.barcode} · arrived {dt(r.arrival_date)} ·
                      {' '}{r.days_after_order} days after the order
                    </div>
                  </div>
                  <span className={'tag ' +
                    (r.confidence >= 80 ? 'bg-good/15 text-good'
                     : r.confidence >= 60 ? 'bg-gold2 text-gold'
                     : 'bg-bad/10 text-bad')}>
                    {r.confidence}% sure
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-3 rounded-md bg-paper p-3 text-sm sm:grid-cols-4">
                  <Pair label="Ordered" value={num(r.qty_ordered, 0)} sub={inr(r.rate_ordered)} />
                  <Pair label="Arrived" value={num(r.qty_arrived, 0)} sub={inr(r.rate_arrived)}
                    tone={short ? 'warn' : null} />
                  <Pair label="Already received" value={num(r.qty_already_received || 0, 0)} />
                  <Pair label="Rate change"
                    value={r.rate_diff_pct == null ? '—'
                      : (rateUp ? '+' : '') + num(r.rate_diff_pct, 1) + '%'}
                    tone={r.rate_diff_pct == null ? null
                      : Math.abs(r.rate_diff_pct) < 2 ? null : rateUp ? 'bad' : 'good'} />
                </div>

                {r.arrived_item !== r.ordered_item && (
                  <p className="mt-2 text-2xs text-gold">
                    The name is not identical — arrived as "{r.arrived_item}". Worth a
                    look before confirming.
                  </p>
                )}

                {short && (
                  <p className="mt-2 text-2xs text-slate2">
                    Less arrived than was ordered. Confirming records what came; the
                    order stays open for the rest.
                  </p>
                )}

                <button className="btn-dark btn-sm mt-3"
                  disabled={busy === r.barcode + r.po_item_id}
                  onClick={() => confirm(r)}>
                  {busy === r.barcode + r.po_item_id ? 'Recording' : 'Yes, this arrived'}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {notice && (
        <div className="fixed inset-x-4 bottom-20 z-40 rounded-lg bg-ink px-4 py-3 text-sm
                        text-white shadow-pop md:inset-x-auto md:bottom-6 md:right-6 md:max-w-sm">
          {notice}
        </div>
      )}
    </div>
  )

  /* ---------- the list ---------- */

  return (
    <div className="page page-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Goods received</h1>
        <p className="text-sm text-slate2">
          Orders where matching stock has arrived. The match is worked out for you;
          confirming is yours.
        </p>
      </div>

      {loading ? <div className="card h-48 animate-pulse bg-line2" />
        : orders.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="mb-1 text-base font-semibold">Nothing waiting</div>
          <p className="text-sm text-slate2">
            No open order has stock arriving against it. This fills as stock is
            uploaded and matched to orders you have raised.
          </p>
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {orders.map(o => (
            <li key={o.po_id}>
              <button onClick={() => setOpen(o)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-paper">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{o.po_no}</span>
                  <span className="block truncate text-2xs text-slate2">
                    {o.supplier_name} · ordered {dt(o.ordered_on)} ·
                    {' '}{o.lines_matched} line{o.lines_matched === 1 ? '' : 's'} ·
                    {' '}{num(o.qty_arrived, 0)} pieces arrived
                  </span>
                </span>
                <span className={'tag shrink-0 ' +
                  (o.strong_matches > 0 ? 'bg-good/15 text-good' : 'bg-gold2 text-gold')}>
                  {o.strong_matches > 0
                    ? `${o.strong_matches} clear`
                    : `${o.avg_confidence}% sure`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-2xs text-slate2">
        There is no shared reference between the billing software and an Atlas order,
        so matching is done on supplier, item, date and quantity. That is good enough
        to put in front of you and not good enough to close an order on its own — two
        orders to the same supplier for the same item a week apart look the same to it.
      </p>
    </div>
  )
}

function Pair({ label, value, sub, tone }) {
  const tones = { warn: 'text-warn', bad: 'text-bad', good: 'text-good' }
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={'text-base font-semibold ' + (tones[tone] || '')}>{value}</div>
      {sub && <div className="text-2xs text-slate2">{sub}</div>}
    </div>
  )
}
