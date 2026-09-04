import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useMe } from '../App'
import Picker from '../components/Picker'
import Field from '../components/Field'

export default function NewPO() {
  const me = useMe()
  const nav = useNavigate()
  const [entities, setEntities] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [types, setTypes] = useState([])
  const [taxRates, setTaxRates] = useState([])
  const [transporters, setTransporters] = useState([])
  const [showDelivery, setShowDelivery] = useState(false)
  const [shops, setShops] = useState([])
  const [locked, setLocked] = useState(null)      // the only entity this user may use
  const [f, setF] = useState({ entity_id: '', supplier_id: '', purchase_type: '',
                               expected_date: '', remarks: '', tax_rate: 5,
                               delivery_address: '', transporter: '', transporter_phone: '', lr_no: '',
                               receipt_mode: 'godown', direct_shop_id: null })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    db.from('entities').select('*').eq('active', true).order('code')
      .then(({ data }) => {
        const allowed = (me.entity_ids?.length ? data.filter(e => me.entity_ids.includes(e.id)) : data) || []
        setEntities(allowed)
        if (allowed.length === 1) {
          setLocked(allowed[0])
          setF(v => ({ ...v, entity_id: allowed[0].id }))
        }
      })
    db.from('suppliers').select('*').eq('active', true).order('name')
      .then(({ data }) => setSuppliers(data || []))
    db.from('settings').select('value').eq('key', 'tax_rates').single()
      .then(({ data }) => setTaxRates(data?.value || [0, 5, 12, 18, 28]))
    db.from('settings').select('value').eq('key', 'transporters').single()
      .then(({ data }) => setTransporters(data?.value || []))
    db.from('settings').select('value').eq('key', 'purchase_types').single()
      .then(({ data }) => {
        const list = data?.value || []
        setTypes(list)
        const fallback = list.find(t => t.toLowerCase().replace(/[^a-z]/g, '') === 'noncc')
        if (fallback) setF(v => (v.purchase_type ? v : { ...v, purchase_type: fallback }))
      })
  }, [])

  const canAddType = ['hod', 'admin'].includes(me.role)

  async function addType() {
    const name = prompt('Name of the new purchase type')?.trim()
    if (!name) return
    if (types.some(t => t.toLowerCase() === name.toLowerCase()))
      return alert('That type already exists')
    const next = [...types, name]
    const { error } = await db.from('settings').update({ value: next }).eq('key', 'purchase_types')
    if (error) return alert('Could not save: ' + error.message)
    setTypes(next)
    setF(v => ({ ...v, purchase_type: name }))
  }

  useEffect(() => {
    if (!f.entity_id) return
    db.from('shops').select('*').eq('active', true).eq('entity_id', f.entity_id).order('code')
      .then(({ data }) => setShops(data || []))
  }, [f.entity_id])

  async function start() {
    if (!f.entity_id) return alert('Choose the entity')
    if (!f.supplier_id) return alert('Choose the supplier')
    if (!f.purchase_type) return alert('Choose the purchase type')
    if (f.receipt_mode === 'direct_shop' && !f.direct_shop_id)
      return alert('Choose which shop this goes to')
    setBusy(true)
    const { data, error } = await db.from('purchase_orders').insert({
      entity_id: f.entity_id,
      supplier_id: f.supplier_id,
      purchase_type: f.purchase_type,
      receipt_mode: f.receipt_mode,
      direct_shop_id: f.receipt_mode === 'direct_shop' ? f.direct_shop_id : null,
      tax_rate: Number(f.tax_rate) || 0,
      delivery_address: f.delivery_address || null,
      transporter: f.transporter || null,
      transporter_phone: f.transporter_phone || null,
      lr_no: f.lr_no || null,
      expected_date: f.expected_date || null,
      remarks: f.remarks || null,
      created_by: me.id,
      status: 'draft'
    }).select().single()
    setBusy(false)
    if (error) return alert(error.message)
    nav('/orders/' + data.id)
  }

  return (
    <div className="page page-sm space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">New purchase order</h1>
        <p className="text-sm text-slate2">
          Supplier and type first. Items and the shop split come next, once the
          order exists.
        </p>
      </div>

      <div className="space-y-3">
        <Field n="1" title="Entity" required done={!!f.entity_id}
          hint="Which company the order is raised under">
          {locked ? (
            <div className="rounded-md border border-line bg-paper px-3 py-2 text-[15px]">
              {locked.name}
              <span className="ml-2 font-mono text-2xs text-slate2">{locked.code}</span>
            </div>
          ) : (
            <Picker label="" placeholder="Choose entity"
              options={entities.map(e => ({ id: e.id, label: e.name, sub: e.code }))}
              value={f.entity_id} onChange={id => setF(v => ({ ...v, entity_id: id }))} />
          )}
        </Field>

        <Field n="2" title="Supplier" required done={!!f.supplier_id}
          hint="Everything below opens once a supplier is chosen">
          <Picker label="" placeholder="Search supplier master"
            options={suppliers.map(s => ({
              id: s.id, label: s.name,
              sub: [s.code, s.credit_days ? s.credit_days + ' days credit' : null].filter(Boolean).join(' · ')
            }))}
            value={f.supplier_id} onChange={id => setF(v => ({ ...v, supplier_id: id }))} />
        </Field>

        {f.supplier_id && (
        <Field n="3" title="Purchase type" required done={!!f.purchase_type}
          hint="What the targets are measured against">
          <select value={f.purchase_type}
            onChange={e => {
              if (e.target.value === '__new') return addType()
              setF(v => ({ ...v, purchase_type: e.target.value }))
            }}>
            {!types.length && <option value="">Loading</option>}
            {types.map(t => <option key={t} value={t}>{t}</option>)}
            {canAddType && <option value="__new">+ Add a new type…</option>}
          </select>
        </Field>
        )}

        {f.supplier_id && (
        <Field n="4" title="Goods will arrive at" required done={!!f.receipt_mode}
          hint="Godown first, or straight to one shop">
          <div className="grid grid-cols-2 gap-2">
            <button type="button"
              onClick={() => setF(v => ({ ...v, receipt_mode: 'godown', direct_shop_id: null }))}
              className={'rounded-md border px-3 py-2 text-left text-sm ' +
                (f.receipt_mode === 'godown'
                  ? 'border-ink bg-ink text-white' : 'border-line bg-white')}>
              <span className="block font-semibold">Godown</span>
              <span className={'block text-[11px] ' +
                (f.receipt_mode === 'godown' ? 'text-white/70' : 'text-slate2')}>
                Send to shops later
              </span>
            </button>
            <button type="button"
              onClick={() => setF(v => ({ ...v, receipt_mode: 'direct_shop' }))}
              className={'rounded-md border px-3 py-2 text-left text-sm ' +
                (f.receipt_mode === 'direct_shop'
                  ? 'border-ink bg-ink text-white' : 'border-line bg-white')}>
              <span className="block font-semibold">Direct to shop</span>
              <span className={'block text-[11px] ' +
                (f.receipt_mode === 'direct_shop' ? 'text-white/70' : 'text-slate2')}>
                Straight from supplier
              </span>
            </button>
          </div>
        </Field>
        )}

        {f.supplier_id && f.receipt_mode === 'direct_shop' && (
          <Field n="5" title="Which shop" required done={!!f.direct_shop_id}
            hint="Where the supplier delivers">
            <Picker label="" placeholder="Choose the shop"
              options={shops.map(s => ({ id: s.id, label: s.name, sub: s.code }))}
              value={f.direct_shop_id}
              onChange={id => setF(v => ({ ...v, direct_shop_id: id }))} />
          </Field>
        )}

        {f.supplier_id && (
        <Field n="6" title="Tax rate" done={f.tax_rate !== ''}
          hint="Applied to every item. Change it per item later if it differs.">
          <select value={f.tax_rate}
            onChange={e => setF(v => ({ ...v, tax_rate: e.target.value }))}>
            {taxRates.map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </Field>
        )}

        <Field n="7" title="Expected delivery" done={!!f.expected_date}
          hint="What lateness is measured against">
          <input type="date" value={f.expected_date}
            onChange={e => setF(v => ({ ...v, expected_date: e.target.value }))} />
        </Field>

        <Field n="8" title="Delivery and transport" done={!!(f.delivery_address || f.transporter)}
          hint="Only needed when it is not the usual godown">
          <button type="button" onClick={() => setShowDelivery(x => !x)}
            className="text-xs font-semibold text-gold">
            {showDelivery ? '− Hide' : '+ Add delivery address and transporter'}
          </button>

        {showDelivery && (
          <div className="mt-3 space-y-3 rounded-md bg-paper p-3">
            <div>
              <label>Deliver to</label>
              <textarea rows={2} value={f.delivery_address}
                onChange={e => setF(v => ({ ...v, delivery_address: e.target.value }))}
                placeholder="Leave blank to deliver to the usual godown" />
            </div>
            <div>
              <label>Transporter</label>
              <input list="transporter-list" value={f.transporter}
                onChange={e => setF(v => ({ ...v, transporter: e.target.value }))}
                placeholder="Name of transporter or parcel service" />
              <datalist id="transporter-list">
                {transporters.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label>Transporter phone</label>
                <input value={f.transporter_phone}
                  onChange={e => setF(v => ({ ...v, transporter_phone: e.target.value }))} /></div>
              <div><label>LR / docket no</label>
                <input value={f.lr_no}
                  onChange={e => setF(v => ({ ...v, lr_no: e.target.value }))} /></div>
            </div>
          </div>
        )}
        </Field>

        <Field n="9" title="Remarks" done={!!f.remarks}
          hint="Anything the approver or the supplier should know">
          <textarea rows={2} value={f.remarks}
            onChange={e => setF(v => ({ ...v, remarks: e.target.value }))}
            placeholder="Urgent / festival stock / replacement order" />
        </Field>

        <button className="btn-dark w-full" onClick={start} disabled={busy}>
          {busy ? 'Creating' : 'Start adding items'}
        </button>
      </div>

      <p className="text-xs text-slate2">
        The order number is generated by the system when you submit for approval.
      </p>
    </div>
  )
}
