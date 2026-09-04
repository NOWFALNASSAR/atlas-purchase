/* ==================================================================
   A NUMBERED FIELD CARD

   §7 asks for each field as its own highlighted section. On a phone a
   single long form is a wall of inputs and people skip things — a card
   per field, numbered, with the number turning into a tick once it is
   filled, means you can see at a glance what is still missing.

   Shared by New task and New purchase order so the two screens do not
   drift apart.
   ================================================================== */

export default function Field({
  n, title, hint, children, required, done, muted
}) {
  return (
    <section className={'card p-4 transition ' +
      (done ? 'border-good/40 ' : '') +
      (muted ? 'opacity-60' : '')}>

      <div className="mb-2 flex items-start gap-2.5">
        <span className={'grid h-6 w-6 shrink-0 place-items-center rounded-full text-2xs font-bold ' +
          (done ? 'bg-good text-white' : 'bg-paper text-slate2')}>
          {done ? '✓' : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {title}{required && <span className="ml-1 text-bad">*</span>}
          </span>
          {hint && <span className="block text-2xs text-slate2">{hint}</span>}
        </span>
      </div>

      <div className="pl-[34px]">{children}</div>
    </section>
  )
}
