import { useEffect, useState } from 'react'

/**
 * Searchable select. Stops staff typing "ABC Textile" one day and
 * "ABC Textiles" the next — everything comes from the master.
 *
 * options: [{ id, label, sub }]
 */
export default function Picker({ label, options, value, onChange, placeholder = 'Search', allowEmpty }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const chosen = options.find(o => o.id === value)

  useEffect(() => { if (!open) setQ('') }, [open])

  const shown = q
    ? options.filter(o => (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 60)
    : options.slice(0, 60)

  return (
    <div>
      {label && <label>{label}</label>}
      <button type="button" onClick={() => setOpen(true)}
        className="w-full rounded-md border border-line bg-white px-3 py-2 text-left text-[15px]">
        {chosen
          ? <span>{chosen.label}{chosen.sub && <span className="ml-2 text-xs text-slate2">{chosen.sub}</span>}</span>
          : <span className="text-slate2">{placeholder}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
             onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-xl bg-white md:rounded-xl"
               onClick={e => e.stopPropagation()}>
            <div className="border-b border-line p-3">
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} />
            </div>
            <ul className="max-h-[65vh] overflow-y-auto">
              {allowEmpty && (
                <li><button type="button" className="w-full px-4 py-3 text-left text-sm text-slate2"
                  onClick={() => { onChange(null); setOpen(false) }}>— none —</button></li>
              )}
              {shown.map(o => (
                <li key={o.id} className="border-t border-line">
                  <button type="button" className="w-full px-4 py-3 text-left hover:bg-paper"
                    onClick={() => { onChange(o.id, o); setOpen(false) }}>
                    <div className="text-sm font-medium">{o.label}</div>
                    {o.sub && <div className="text-[11px] text-slate2">{o.sub}</div>}
                  </button>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-slate2">
                  Nothing matches “{q}”. Ask the HOD to add it to the master.
                </li>
              )}
            </ul>
            <div className="border-t border-line p-3">
              <button type="button" className="btn-ghost w-full" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
