import { useState } from 'react'

/* ==================================================================
   ASK BEFORE DOING SOMETHING

   Replaces window.prompt(), which had two problems.

   The first was a real bug: `prompt(...) || null` treats Cancel and
   "left it blank" as the same answer, so pressing Cancel still went
   ahead with the action. Cancel must mean stop.

   The second is that some in-app browsers — WhatsApp's among them —
   block prompt() entirely. The button then appears to do nothing at
   all, which is worse than an error.
   ================================================================== */

export default function AskSheet({
  title,
  message,
  label = 'Note',
  placeholder = '',
  required = false,
  confirmLabel = 'Confirm',
  tone = 'dark',              // dark | gold | bad
  warning,                    // shown in amber above the field
  blocked,                    // when set, the action cannot proceed at all
  onConfirm,
  onClose
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function go() {
    if (required && !text.trim()) {
      setErr('This cannot be left blank')
      return
    }
    setBusy(true); setErr(null)
    try {
      await onConfirm(text.trim() || null)
    } catch (e) {
      setErr(e?.message || 'Could not do that')
      setBusy(false)
      return
    }
    setBusy(false)
  }

  const btn = { dark: 'btn-dark', gold: 'btn-gold', bad: 'btn-bad' }[tone] || 'btn-dark'

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 md:items-center"
      onClick={onClose}>
      <div className="safe-b w-full max-w-md rounded-t-xl bg-white p-5 shadow-pop md:rounded-xl"
        onClick={e => e.stopPropagation()}>

        <h2 className="text-base font-semibold">{title}</h2>
        {message && <p className="mt-1 text-sm text-slate2">{message}</p>}

        {blocked ? (
          <>
            <div className="mt-4 rounded-md bg-bad/10 px-3 py-3 text-sm text-bad">
              {blocked}
            </div>
            <button className="btn-ghost mt-4 w-full" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            {warning && (
              <div className="mt-3 rounded-md bg-gold2 px-3 py-2.5 text-xs text-gold">
                {warning}
              </div>
            )}

            <div className="mt-4">
              <label>{label}{required && <span className="ml-1 text-bad">*</span>}</label>
              <textarea rows={3} value={text} autoFocus placeholder={placeholder}
                onChange={e => { setText(e.target.value); setErr(null) }} />
            </div>

            {err && (
              <div className="mt-2 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>
            )}

            <div className="mt-4 flex gap-2">
              <button className={btn + ' flex-1'} disabled={busy} onClick={go}>
                {busy ? 'Working' : confirmLabel}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
