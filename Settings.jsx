import { useEffect, useState } from 'react'
import { db } from '../lib/db'

/** Admin edits purchase types and company details without touching code. */
export default function Settings() {
  const [types, setTypes] = useState([])
  const [newType, setNewType] = useState('')
  const [company, setCompany] = useState({ name: '', address: '', phone: '', email: '' })
  const [saved, setSaved] = useState('')

  useEffect(() => {
    db.from('settings').select('*').in('key', ['purchase_types', 'company'])
      .then(({ data }) => {
        data?.forEach(r => {
          if (r.key === 'purchase_types') setTypes(r.value || [])
          if (r.key === 'company') setCompany(r.value || {})
        })
      })
  }, [])

  async function saveTypes(next) {
    setTypes(next)
    const { error } = await db.from('settings').update({ value: next }).eq('key', 'purchase_types')
    flash(error ? error.message : 'Purchase types saved')
  }

  async function saveCompany() {
    const { error } = await db.from('settings').update({ value: company }).eq('key', 'company')
    flash(error ? error.message : 'Company details saved')
  }

  function flash(msg) { setSaved(msg); setTimeout(() => setSaved(''), 2500) }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-xl font-bold">Settings</h1>

      {saved && <div className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">{saved}</div>}

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-bold">Purchase types</h2>
        <p className="mb-3 text-xs text-slate2">
          These appear as buttons on the new order screen. Every order must have one,
          so reports can be filtered by type.
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
          <button className="btn-dark shrink-0"
            onClick={() => {
              const v = newType.trim()
              if (!v) return
              if (types.includes(v)) return alert('That type already exists')
              saveTypes([...types, v]); setNewType('')
            }}>Add</button>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-bold">Company details on the PO PDF</h2>
        {['name', 'address', 'phone', 'email'].map(k => (
          <div key={k}>
            <label>{k}</label>
            <input value={company[k] || ''}
              onChange={e => setCompany(c => ({ ...c, [k]: e.target.value }))} />
          </div>
        ))}
        <button className="btn-dark w-full" onClick={saveCompany}>Save company details</button>
      </section>

      <p className="text-xs text-slate2">
        Approval slabs are in Supabase → Table Editor → settings → approval_slabs.
        Change the ₹ limits there and they apply to the next order submitted.
      </p>
    </div>
  )
}
