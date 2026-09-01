import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, inr, lakh, dt } from '../lib/db'
import { useMe, useEntity } from '../App'
import Picker from '../components/Picker'
import { Modal } from './Suppliers'

/**
 * Everything bought that hasn't reached a shop yet.
 * Send it out whenever you decide — today, next week, in pieces.
 */
export default function Godown() {
  const me = useMe()
  const { entityId } = useEntity()
  const [rows, setRows] = useState([])
  const [shops, setShops] = useState([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('days')
  const [send, setSend] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (entityId) load() }, [entityId])

  async function load() {
    setLoading(true)
    let sel = db.from('v_godown_stock').select('*').limit(1000)
    if (entityId && entityId !== 'mixed') sel = sel.eq('entity_id', entityId)
    const { data } = await sel
    setRows(data || [])

    let sh = db.from('shops').select('*').eq('active', true).order('code')
    if (entityId && entityId !== 'mixed') sh = sh.eq('entity_id', entityId)
    const { data: shopData } = await sh
    setShops(shopData || [])
    setLoading(false)
  }

  async function dispatch() {
    const n = Number(send.qty)
    if (!send.shop_id) return alert('Choose the shop')
    if (!n || n <= 0) return alert('Enter how many pieces')
    if (n > send.row.in_godown) return alert(`Only ${send.row.in_godown} left in the godown`)

    const { error } = await db.from('po_item_allocations').insert({
      po_id: send.row.po_id,
      po_item_id: send.row.po_item_id,
      shop_id: send.shop_id,
      qty: n,
      note: send.note || null,
      dispatched_by: me.id
    })
    if (error) return alert(error.message)
    setSend(null); load()
  }

  const shown = rows
    .filter(r => !q || (r.item_name + r.item_code + r.po_no + r.supplier_name)
      .toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === 'days'  ? b.days_held - a.days_held :
      sort === 'value' ? b.value_in_godown - a.value_in_godown :
      sort === 'qty'   ? b.in_godown - a.in_godown :
      a.item_name.localeCompare(b.item_name))

  const totalValue = shown.reduce((s, r) => s + Number(r.value_in_godown), 0)
  const totalQty = shown.reduce((s, r) => s + r.in_godown, 0)
  const old = shown.filter(r => r.days_held > 30)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Godown</h1>
        <p className="text-sm text-slate2">
          Stock you have bought that hasn't gone to a shop yet. Send it out in
          any quantity, whenever you decide.
        </p>
      </div>

      <div className="card grid grid-cols-3 divide-x divide-line">
        <Stat label="Pieces held" value={totalQty.toLocaleString('en-IN')} />
        <Stat label="Value" value={lakh(totalValue)} />
        <Stat label="Over 30 days" value={old.length} warn={old.length > 0} />
      </div>

      {old.length > 0 && (
        <div className="card border-l-4 border-l-gold p-4">
          <div className="text-sm font-bold">
            {old.length} items sitting more than 30 days
          </div>
          <div className="mt-1 text-[13px] text-slate2">
            {inr(old.reduce((s, r) => s + Number(r.value_in_godown), 0))} of stock
            bought and never sent. Oldest: {old[0].item_name}, {old[0].days_held} days.
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <input className="col-span-2" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search item, code, PO or supplier" />
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="days">Oldest first</option>
          <option value="value">Highest value</option>
          <option value="qty">Most pieces</option>
          <option value="name">Item name</option>
        </select>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate2">Loading</div>
      ) : shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate2">
          Nothing in the godown. Everything bought has been sent to shops.
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {shown.map(r => (
            <li key={r.po_item_id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{r.item_name}</div>
                  <div className="font-mono text-[11px] text-slate2">
                    {[r.item_code, r.model_no, r.colour, r.size].filter(Boolean).join(' · ')}
                  </div>
                  <div className="mt-1 text-[11px] text-slate2">
                    <Link to={'/orders/' + r.po_id} className="underline">{r.po_no}</Link>
                    {' · '}{r.supplier_name}{' · '}{dt(r.approved_at || r.created_at)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">{r.in_godown}</div>
                  <div className="text-[11px] text-slate2">of {r.bought} bought</div>
                  <div className="text-[11px] text-slate2">{inr(r.value_in_godown)}</div>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className={'text-[11px] font-semibold ' +
                  (r.days_held > 30 ? 'text-gold' : 'text-slate2')}>
                  {r.days_held} days in godown
                  {r.sent > 0 && ` · ${r.sent} already sent`}
                </span>
                <button className="btn-gold !px-3 !py-1.5 !text-xs"
                  onClick={() => setSend({ row: r, shop_id: null, qty: r.in_godown, note: '' })}>
                  Send to shop
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {send && (
        <Modal title="Send stock to a shop" onClose={() => setSend(null)}>
          <div className="mb-3 rounded-md bg-paper p-3">
            <div className="text-sm font-semibold">{send.row.item_name}</div>
            <div className="text-[11px] text-slate2">
              {send.row.item_code} · {send.row.po_no} · {inr(send.row.purchase_rate)} each
            </div>
            <div className="mt-1 text-[13px]">
              <b>{send.row.in_godown}</b> pieces available
            </div>
          </div>

          <div className="space-y-3">
            <Picker label="Shop" placeholder="Which shop?"
              options={shops.map(s => ({ id: s.id, label: s.name, sub: s.code }))}
              value={send.shop_id} onChange={id => setSend(v => ({ ...v, shop_id: id }))} />

            <div>
              <label>Quantity (max {send.row.in_godown})</label>
              <input type="number" inputMode="numeric" value={send.qty}
                onChange={e => setSend(v => ({ ...v, qty: e.target.value }))} />
            </div>

            <div>
              <label>Note (optional)</label>
              <input value={send.note} placeholder="Sent by own vehicle / with Onam stock"
                onChange={e => setSend(v => ({ ...v, note: e.target.value }))} />
            </div>
          </div>

          <button className="btn-dark mt-4 w-full" onClick={dispatch}>
            Send {send.qty} pieces
          </button>
          <p className="mt-2 text-center text-[11px] text-slate2">
            You can send the rest later, to this shop or another one.
          </p>
        </Modal>
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
