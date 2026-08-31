import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { Modal } from './Suppliers'

/** Admin screen: entities, shops, purchase types, company details. */
export default function Settings() {
  const [tab, setTab] = useState('entities')
  const [saved, setSaved] = useState('')
  const flash = m => { setSaved(m); setTimeout(() => setSaved(''), 2500) }

  const TABS = [
    ['entities', 'Entities'],
    ['shops', 'Shops'],
    ['types', 'Purchase types'],
    ['company', 'Company']
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

      {saved && <div className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{saved}</div>}

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (tab === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'entities' && <Entities flash={flash} />}
      {tab === 'shops'    && <Shops flash={flash} />}
      {tab === 'types'    && <PurchaseTypes flash={flash} />}
      {tab === 'company'  && <Company flash={flash} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ENTITIES                                                            */
/* ------------------------------------------------------------------ */

function Entities({ flash }) {
  const [rows, setRows] = useState([])
  const [edit, setEdit] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await db.from('entities').select('*').order('code')
    setRows(data || [])
  }

  async function save() {
    if (!edit.name?.trim()) return alert('Entity name is required')
    if (!edit.code?.trim()) return alert('Entity code is required')
    const row = {
      code: edit.code.trim().toUpperCase(),
      name: edit.name.trim(),
      gstin: edit.gstin || null,
      active: edit.active
    }
    const { error } = edit.id
      ? await db.from('entities').update(row).eq('id', edit.id)
      : await db.from('entities').insert(row)
    if (error) return alert(error.message)
    flash(edit.id ? 'Entity updated' : 'Entity added')
    setEdit(null); load()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate2">
          Renaming is safe — existing orders follow the new name automatically.
        </p>
        <button className="btn-gold shrink-0"
          onClick={() => setEdit({ code: '', name: '', gstin: '', active: true })}>
          Add entity
        </button>
      </div>

      <ul className="card divide-y divide-line">
        {rows.map(e => (
          <li key={e.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper"
              onClick={() => setEdit(e)}>
              <span className="w-10 font-mono text-[12px] font-bold text-slate2">{e.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {e.name} {!e.active && <span className="tag bg-line text-slate2">off</span>}
                </span>
                {e.gstin && <span className="text-[11px] text-slate2">{e.gstin}</span>}
              </span>
              <span className="text-xs text-slate2">Edit</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="p-8 text-center text-sm text-slate2">No entities yet.</li>}
      </ul>

      {edit && (
        <Modal title={edit.id ? 'Edit entity' : 'New entity'} onClose={() => setEdit(null)}>
          <div className="space-y-3">
            <div><label>Entity name *</label>
              <input value={edit.name || ''} autoFocus
                onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} /></div>
            <div><label>Code * (short, e.g. E1)</label>
              <input value={edit.code || ''} maxLength={6}
                onChange={e => setEdit(v => ({ ...v, code: e.target.value }))} />
              <p className="mt-1 text-[11px] text-slate2">
                Used in order numbers: ATL/<b>{(edit.code || 'E1').toUpperCase()}</b>/PO/26-27/00001.
                Changing it does not alter numbers already issued.
              </p>
            </div>
            <div><label>GSTIN</label>
              <input value={edit.gstin || ''}
                onChange={e => setEdit(v => ({ ...v, gstin: e.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="!w-auto" checked={edit.active}
                onChange={e => setEdit(v => ({ ...v, active: e.target.checked }))} />
              <span className="normal-case tracking-normal">Active — can be used in new orders</span>
            </label>
          </div>
          <button className="btn-dark mt-4 w-full" onClick={save}>Save entity</button>
        </Modal>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* SHOPS                                                               */
/* ------------------------------------------------------------------ */

function Shops({ flash }) {
  const [rows, setRows] = useState([])
  const [entities, setEntities] = useState([])
  const [edit, setEdit] = useState(null)
  const [filter, setFilter] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    const [{ data: sh }, { data: en }] = await Promise.all([
      db.from('shops').select('*, entities(code,name)').order('code'),
      db.from('entities').select('*').order('code')
    ])
    setRows(sh || []); setEntities(en || [])
  }

  async function save() {
    if (!edit.name?.trim()) return alert('Shop name is required')
    if (!edit.code?.trim()) return alert('Shop code is required')
    if (!edit.entity_id) return alert('Choose which entity this shop belongs to')
    const row = {
      entity_id: edit.entity_id,
      code: edit.code.trim().toUpperCase(),
      name: edit.name.trim(),
      shop_type: edit.shop_type || 'budget',
      location: edit.location || null,
      manager: edit.manager || null,
      phone: edit.phone || null,
      gstin: edit.gstin || null,
      active: edit.active
    }
    const { error } = edit.id
      ? await db.from('shops').update(row).eq('id', edit.id)
      : await db.from('shops').insert(row)
    if (error) return alert(error.message)
    flash(edit.id ? 'Shop updated' : 'Shop added')
    setEdit(null); load()
  }

  const shown = filter ? rows.filter(s => s.entity_id === filter) : rows

  return (
    <>
      <div className="flex items-center gap-2">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All entities ({rows.length} shops)</option>
          {entities.map(e => (
            <option key={e.id} value={e.id}>
              {e.name} ({rows.filter(s => s.entity_id === e.id).length})
            </option>
          ))}
        </select>
        <button className="btn-gold shrink-0"
          onClick={() => setEdit({ code: '', name: '', entity_id: filter || entities[0]?.id,
                                   shop_type: 'budget', active: true })}>
          Add shop
        </button>
      </div>

      <ul className="card divide-y divide-line">
        {shown.map(s => (
          <li key={s.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper"
              onClick={() => setEdit(s)}>
              <span className="w-10 font-mono text-[12px] font-bold text-slate2">{s.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {s.name} {!s.active && <span className="tag bg-line text-slate2">off</span>}
                </span>
                <span className="text-[11px] text-slate2">
                  {[s.entities?.code, s.location, s.shop_type === 'premium' ? 'Premium' : null]
                    .filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="text-xs text-slate2">Edit</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="p-8 text-center text-sm text-slate2">No shops here.</li>}
      </ul>

      {edit && (
        <Modal title={edit.id ? 'Edit shop' : 'New shop'} onClose={() => setEdit(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><label>Shop name *</label>
              <input value={edit.name || ''} autoFocus
                onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} /></div>
            <div><label>Shop code *</label>
              <input value={edit.code || ''} maxLength={8}
                onChange={e => setEdit(v => ({ ...v, code: e.target.value }))} /></div>
            <div><label>Entity *</label>
              <select value={edit.entity_id || ''}
                onChange={e => setEdit(v => ({ ...v, entity_id: e.target.value }))}>
                <option value="">Choose entity</option>
                {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select></div>
            <div><label>Type</label>
              <select value={edit.shop_type || 'budget'}
                onChange={e => setEdit(v => ({ ...v, shop_type: e.target.value }))}>
                <option value="budget">Budget showroom</option>
                <option value="premium">Premium / wedding centre</option>
              </select></div>
            <div><label>Location</label>
              <input value={edit.location || ''}
                onChange={e => setEdit(v => ({ ...v, location: e.target.value }))} /></div>
            <div><label>Manager</label>
              <input value={edit.manager || ''}
                onChange={e => setEdit(v => ({ ...v, manager: e.target.value }))} /></div>
            <div><label>Phone</label>
              <input value={edit.phone || ''}
                onChange={e => setEdit(v => ({ ...v, phone: e.target.value }))} /></div>
            <div className="md:col-span-2"><label>GSTIN</label>
              <input value={edit.gstin || ''}
                onChange={e => setEdit(v => ({ ...v, gstin: e.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" className="!w-auto" checked={edit.active}
                onChange={e => setEdit(v => ({ ...v, active: e.target.checked }))} />
              <span className="normal-case tracking-normal">
                Active — can receive stock in new orders
              </span>
            </label>
          </div>
          <button className="btn-dark mt-4 w-full" onClick={save}>Save shop</button>
        </Modal>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* PURCHASE TYPES                                                      */
/* ------------------------------------------------------------------ */

function PurchaseTypes({ flash }) {
  const [types, setTypes] = useState([])
  const [newType, setNewType] = useState('')

  useEffect(() => {
    db.from('settings').select('value').eq('key', 'purchase_types').single()
      .then(({ data }) => setTypes(data?.value || []))
  }, [])

  async function saveTypes(next) {
    setTypes(next)
    const { error } = await db.from('settings').update({ value: next }).eq('key', 'purchase_types')
    flash(error ? error.message : 'Purchase types saved')
  }

  return (
    <section className="card p-4">
      <p className="mb-3 text-xs text-slate2">
        These fill the dropdown on the new order screen. Non CC is pre-selected.
        Removing a type here does not change orders already using it.
      </p>

      <ul className="mb-3 flex flex-wrap gap-2">
        {types.map(t => (
          <li key={t} className="flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-sm">
            {t}
            <button onClick={() => saveTypes(types.filter(x => x !== t))}
              className="ml-1 font-bold text-bad" aria-label={'Remove ' + t}>×</button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input value={newType} onChange={e => setNewType(e.target.value)}
          placeholder="e.g. PMNA Fest" />
        <button className="btn-dark shrink-0" onClick={() => {
          const v = newType.trim()
          if (!v) return
          if (types.some(t => t.toLowerCase() === v.toLowerCase())) return alert('That type already exists')
          saveTypes([...types, v]); setNewType('')
        }}>Add</button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* COMPANY                                                             */
/* ------------------------------------------------------------------ */

function Company({ flash }) {
  const [company, setCompany] = useState({ name: '', address: '', phone: '', email: '' })

  useEffect(() => {
    db.from('settings').select('value').eq('key', 'company').single()
      .then(({ data }) => setCompany(data?.value || {}))
  }, [])

  async function save() {
    const { error } = await db.from('settings').update({ value: company }).eq('key', 'company')
    flash(error ? error.message : 'Company details saved')
  }

  return (
    <section className="card space-y-3 p-4">
      <p className="text-xs text-slate2">This is what prints at the top of every supplier PO.</p>
      {['name', 'address', 'phone', 'email'].map(k => (
        <div key={k}>
          <label>{k}</label>
          <input value={company[k] || ''}
            onChange={e => setCompany(c => ({ ...c, [k]: e.target.value }))} />
        </div>
      ))}
      <button className="btn-dark w-full" onClick={save}>Save company details</button>
      <p className="text-xs text-slate2">
        Approval slabs and tax rates are in Supabase → Table Editor → settings.
      </p>
    </section>
  )
}
