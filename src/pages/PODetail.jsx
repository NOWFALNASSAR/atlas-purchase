import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db, inr, dt, dtTime, statusStyle, roleLabel, margin } from '../lib/db'
import { downloadPoPdf, poMessage, whatsappLink } from '../lib/pdf'
import { useMe } from '../App'
import ItemEditor from '../components/ItemEditor'

export default function PODetail() {
  const { id } = useParams()
  const me = useMe()
  const nav = useNavigate()

  const [po, setPo] = useState(null)
  const [lines, setLines] = useState([])
  const [allocs, setAllocs] = useState([])
  const [items, setItems] = useState([])
  const [shops, setShops] = useState([])
  const [history, setHistory] = useState([])
  const [company, setCompany] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => { loadAll() }, [id])

  async function loadAll() {
    const { data: p } = await db.from('purchase_orders')
      .select('*, suppliers(*), entities(*), profiles!purchase_orders_created_by_fkey(full_name)')
      .eq('id', id).single()
    setPo(p)
    if (!p) return

    const [{ data: li }, { data: al }, { data: it }, { data: sh }, { data: hi }, { data: st }] =
      await Promise.all([
        db.from('po_items').select('*').eq('po_id', id).order('sort_order'),
        db.from('po_item_allocations').select('*, shops(code,name)').eq('po_id', id),
        db.from('items').select('*').eq('active', true).order('name'),
        db.from('shops').select('*').eq('active', true).eq('entity_id', p.entity_id).order('code'),
        db.from('po_history').select('*').eq('po_id', id).order('created_at', { ascending: false }),
        db.from('settings').select('value').eq('key', 'company').single()
      ])
    setLines(li || []); setAllocs(al || []); setItems(it || [])
    setShops(sh || []); setHistory(hi || []); setCompany(st?.value || {})
  }

  if (!po) return <div className="py-16 text-center text-sm text-slate2">Loading order</div>

  const isOwner   = po.created_by === me.id
  const editable  = isOwner && ['draft', 'rejected'].includes(po.status)
  const canDecide = po.status === 'pending' && (me.role === 'admin' || po.pending_role === me.role)
  const canSend   = ['approved', 'sent'].includes(po.status) &&
                    ['executive', 'manager', 'hod', 'admin'].includes(me.role)
  const totalMargin = margin(po.total_purchase, po.total_sales)

  /* shop-wise summary of the whole order */
  const shopTotals = {}
  allocs.forEach(a => {
    const k = a.shops?.code + ' ' + a.shops?.name
    const line = lines.find(l => l.id === a.po_item_id)
    shopTotals[k] = shopTotals[k] || { qty: 0, value: 0 }
    shopTotals[k].qty += a.qty
    shopTotals[k].value += a.qty * Number(line?.purchase_rate || 0)
  })

  async function call(fn, args, okMsg) {
    setBusy(true)
    const { error } = await db.rpc(fn, args)
    setBusy(false)
    if (error) return alert(error.message)
    if (okMsg) alert(okMsg)
    loadAll()
  }

  const submit = () => {
    if (!lines.length) return alert('Add at least one item')
    if (confirm(`Submit ${inr(po.total_purchase)} for approval?`)) call('submit_po', { p_po: po.id })
  }
  const approve = () => call('approve_po', { p_po: po.id, p_note: prompt('Note with your approval? (optional)') || null })
  const reject  = () => { const n = prompt('Reason for rejecting:'); if (n?.trim()) call('reject_po', { p_po: po.id, p_note: n }) }
  const reopen  = () => call('reopen_po', { p_po: po.id })

  function sendWhatsapp() {
    downloadPoPdf(po, lines, allocs, company)
    window.open(whatsappLink(po.suppliers?.whatsapp || po.suppliers?.mobile, poMessage(po, company)), '_blank')
    call('mark_sent', { p_po: po.id, p_channel: 'whatsapp' })
  }
  function sendEmail() {
    downloadPoPdf(po, lines, allocs, company)
    const subject = `Purchase Order ${po.po_no} — ${company.name || 'Atlas Maharani Group'}`
    window.location.href = `mailto:${po.suppliers?.email || ''}?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(poMessage(po, company) + '\n\n(PO PDF attached)')}`
    call('mark_sent', { p_po: po.id, p_channel: 'email' })
  }

  async function deleteDraft() {
    if (!confirm('Delete this draft order?')) return
    await db.from('purchase_orders').delete().eq('id', po.id)
    nav('/orders')
  }

  const addLine = () => setLines(l => [...l, { po_id: po.id, purchase_rate: '', selling_rate: '' }])

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="card overflow-hidden">
        <div className="flex items-start gap-3 bg-ink p-4 text-white">
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold">{po.suppliers?.name}</div>
            <div className="font-mono text-[12px] text-white/60">{po.po_no || 'Draft — not yet numbered'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-white/60">
              <span>{po.entities?.code}</span>
              {po.purchase_type && (
                <span className="rounded bg-white/15 px-1.5 py-0.5 font-semibold text-white">
                  {po.purchase_type}
                </span>
              )}
              <span>{po.profiles?.full_name}</span>
              <span>{dt(po.created_at)}</span>
            </div>
          </div>
          <span className={'tag ' + statusStyle(po.status)}>{po.status}</span>
        </div>

        {po.status === 'pending' && (
          <div className="bg-gold/10 px-4 py-2 text-[13px] font-semibold text-gold">
            Waiting for {roleLabel(po.pending_role)}
            {po.approval_chain?.length > 1 &&
              <span className="ml-1 font-normal">· {po.approval_chain.map(roleLabel).join(' → ')}</span>}
          </div>
        )}

        <div className="grid grid-cols-2 divide-x divide-line border-t border-line md:grid-cols-3">
          <Cell label="Quantity" value={po.total_qty} />
          <Cell label="Purchase value" value={inr(po.total_purchase)} />
          <Cell label={'Tax' + (po.tax_rate ? ` (${po.tax_rate}% default)` : '')}
                value={inr(po.total_tax)} />
        </div>
        <div className="grid grid-cols-2 divide-x divide-line border-t border-line md:grid-cols-3">
          <Cell label="Payable to supplier" value={inr(po.grand_total || po.total_purchase)} strong />
          <Cell label="Expected sales" value={inr(po.total_sales)} />
          <Cell label="Margin" value={totalMargin + '%'} warn={totalMargin < 25} />
        </div>

        {(po.expected_date || po.remarks || po.delivery_address || po.transporter) && (
          <div className="space-y-1 border-t border-line px-4 py-3 text-[13px]">
            {po.expected_date && <div><span className="text-slate2">Expected delivery: </span>{dt(po.expected_date)}</div>}
            {po.delivery_address && (
              <div><span className="text-slate2">Deliver to: </span>{po.delivery_address}</div>
            )}
            {po.transporter && (
              <div>
                <span className="text-slate2">Transporter: </span>{po.transporter}
                {po.transporter_phone && ' · ' + po.transporter_phone}
                {po.lr_no && ' · LR ' + po.lr_no}
              </div>
            )}
            {po.remarks && <div><span className="text-slate2">Remarks: </span>{po.remarks}</div>}
          </div>
        )}
      </div>

      {/* items */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-bold">Items ({lines.length})</h2>
          {editable && <button className="text-xs font-semibold text-gold underline" onClick={addLine}>+ Add item</button>}
        </div>

        {lines.length === 0 && (
          <div className="border-t border-line px-4 py-8 text-center text-sm text-slate2">
            No items yet. {editable && <button className="underline" onClick={addLine}>Add the first item</button>}
          </div>
        )}

        {lines.map((l, i) => (
          <ItemEditor key={l.id || 'new-' + i}
            line={l} index={i} items={items} shops={shops} editable={editable}
            onSaved={row => { setLines(ls => ls.map((x, j) => (j === i ? row : x))); refresh() }}
            onDeleted={() => { setLines(ls => ls.filter((_, j) => j !== i)); refresh() }} />
        ))}
      </div>

      {/* shop-wise summary */}
      {Object.keys(shopTotals).length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 text-sm font-bold">Shop-wise distribution</div>
          <table className="w-full text-[13px]">
            <thead className="bg-paper text-[11px] uppercase tracking-wider text-slate2">
              <tr>
                <th className="px-4 py-2 text-left">Shop</th>
                <th className="px-3 py-2 text-right">Pieces</th>
                <th className="px-4 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(shopTotals).sort().map(([shop, t]) => (
                <tr key={shop} className="border-t border-line">
                  <td className="px-4 py-2">{shop}</td>
                  <td className="px-3 py-2 text-right font-semibold">{t.qty}</td>
                  <td className="px-4 py-2 text-right">{inr(t.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* actions */}
      <div className="space-y-2">
        {editable && (
          <>
            <button className="btn-gold w-full" onClick={submit} disabled={busy || !lines.length}>
              Submit for approval
            </button>
            {po.status === 'draft' && <button className="btn-ghost w-full" onClick={deleteDraft}>Delete draft</button>}
          </>
        )}
        {po.status === 'rejected' && isOwner &&
          <button className="btn-ghost w-full" onClick={reopen}>Reopen for editing</button>}
        {canDecide && (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-dark" onClick={approve} disabled={busy}>Approve</button>
            <button className="btn-bad" onClick={reject} disabled={busy}>Reject</button>
          </div>
        )}
        {po.po_no && (
          <button className="btn-ghost w-full" onClick={() => downloadPoPdf(po, lines, allocs, company)}>
            Download PO PDF
          </button>
        )}
        {canSend && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-dark" onClick={sendWhatsapp}>Send on WhatsApp</button>
              <button className="btn-ghost" onClick={sendEmail}>Send by email</button>
            </div>
            <p className="text-center text-xs text-slate2">
              The PDF downloads first — attach it in WhatsApp before sending.
            </p>
          </>
        )}
      </div>

      {/* audit */}
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-bold">History</h2>
        <ol className="space-y-2.5">
          {history.map(h => (
            <li key={h.id} className="flex gap-3 text-[13px]">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
              <span className="flex-1">
                <span className="font-semibold">{h.action.replace(/_/g, ' ')}</span>
                {h.note && <span className="text-slate2"> — {h.note}</span>}
                <span className="block text-[11px] text-slate2">
                  {h.actor_name || 'system'} · {dtTime(h.created_at)}
                </span>
              </span>
            </li>
          ))}
          {history.length === 0 && <li className="text-[13px] text-slate2">Nothing recorded yet.</li>}
        </ol>
      </div>
    </div>
  )

  async function refresh() {
    const [{ data: p }, { data: al }] = await Promise.all([
      db.from('purchase_orders')
        .select('*, suppliers(*), entities(*), profiles!purchase_orders_created_by_fkey(full_name)')
        .eq('id', id).single(),
      db.from('po_item_allocations').select('*, shops(code,name)').eq('po_id', id)
    ])
    setPo(p); setAllocs(al || [])
  }
}

function Cell({ label, value, warn, strong }) {
  return (
    <div className={'px-4 py-3 ' + (strong ? 'bg-ink/5' : '')}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate2">{label}</div>
      <div className={'font-bold ' + (strong ? 'text-lg' : 'text-base') + (warn ? ' text-gold' : '')}>
        {value}
      </div>
    </div>
  )
}
