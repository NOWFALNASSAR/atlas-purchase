import { useEffect, useState } from 'react'
import { db, dt, inr } from '../lib/db'

/* ==================================================================
   WHAT CAME IN TODAY

   A shop that quietly stops uploading produces no error. Its sales
   simply stop appearing and the company total drops, with nothing to
   say why. Missing is invisible unless something goes looking, so this
   sits at the top of every report and says what is not there.
   ================================================================== */

export default function UploadStatus() {
  const [head, setHead] = useState(null)
  const [problems, setProblems] = useState([])
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    db.from('v_upload_headline').select('*').maybeSingle()
      .then(({ data, error }) => { if (live) { if (error) setFailed(true); setHead(data) } })
    return () => { live = false }
  }, [])

  async function show() {
    setOpen(true)
    if (problems.length) return
    const { data } = await db.from('v_upload_problems').select('*')
      .order('severity', { ascending: false }).limit(60)
    setProblems(data || [])
  }

  if (failed || !head) return null

  const salesShort = head.shops - (head.sales_in || 0)
  const stockShort = head.shops - (head.stock_in || 0)
  const allIn = salesShort === 0 && stockShort === 0

  return (
    <>
      <section className={'card px-4 py-3 ' +
        (allIn ? 'border-good/40' : 'border-gold/40 bg-gold2')}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className={'text-sm font-semibold ' + (allIn ? '' : 'text-gold')}>
            {head.last_sale_date
              ? `Sales to ${dt(head.last_sale_date)}`
              : 'No sales uploaded yet'}
          </span>

          <span className="text-sm text-slate2">
            {head.sales_in} of {head.shops} shops
            {salesShort > 0 && head.sales_pending && (
              <span className="text-gold"> · {head.sales_pending} pending</span>
            )}
          </span>

          <span className="text-mute">|</span>

          <span className="text-sm text-slate2">
            {head.last_stock_date ? `Stock to ${dt(head.last_stock_date)}` : 'No stock uploaded'}
            {' · '}{head.stock_in} of {head.shops}
            {stockShort > 0 && head.stock_pending && (
              <span className="text-gold"> · {head.stock_pending} pending</span>
            )}
          </span>

          <button onClick={show}
            className="ml-auto shrink-0 text-xs font-semibold text-slate2 hover:text-ink">
            Details
          </button>
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
          onClick={() => setOpen(false)}>
          <div className="safe-b max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-xl
                          bg-white shadow-pop md:rounded-xl"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-line
                            bg-white px-5 py-3">
              <h2 className="text-base font-semibold">What needs attention</h2>
              <button className="text-sm text-slate2" onClick={() => setOpen(false)}>Close</button>
            </div>

            {problems.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate2">
                Nothing outstanding. Every shop is up to date and the figures agree.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {problems.map((p, i) => (
                  <li key={i} className="px-5 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold">{p.shop}</span>
                      <span className="text-xs text-slate2">{p.problem}</span>
                      {p.on_date && (
                        <span className="text-2xs text-mute">{dt(p.on_date)}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate2">{p.detail}</div>
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t border-line px-5 py-3 text-2xs text-slate2">
              A shop is pending when its last upload is older than the newest one
              anyone made. Sales that cannot be classified are barcodes present in no
              stock file — usually a batch that sold out before the stock export was
              taken.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
