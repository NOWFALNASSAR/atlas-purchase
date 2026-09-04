import { useState } from 'react'
import {
  canShareFiles, sharePdfFile, uploadPdfForLink,
  openWhatsApp, saveBlob, copyText
} from '../lib/share'

/* ==================================================================
   SEND A PDF

   One sheet, used for purchase orders, end-of-day reports, anything.

   The first option is the one that actually attaches the file, and it
   only appears on devices that can do it. On a laptop it is hidden,
   because a button that cannot work is worse than no button.
   ================================================================== */

export default function SendPdfSheet({
  title = 'Send',
  filename,
  message,
  number,                 // where it goes: supplier, department
  numberLabel,            // who that is
  build,                  // () => Blob | Promise<Blob>
  bucket = 'po-pdfs',
  folder = 'shared',
  onSent,                 // (channel) => void  — for marking it sent
  onClose
}) {
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState(null)
  const [link, setLink] = useState(null)

  const canAttach = canShareFiles()

  async function blob() {
    const b = await build()
    if (!b) throw new Error('The PDF could not be built')
    return b
  }

  /* 1 — the real thing: file attached */
  async function attach() {
    setBusy('attach'); setNote(null)
    try {
      const res = await sharePdfFile({ blob: await blob(), filename, text: message, title })
      if (res === 'shared') { onSent?.('whatsapp'); onClose?.() }
      else if (res === 'cancelled') setNote('Cancelled.')
      else setNote('This device cannot attach files. Use the link instead.')
    } catch (e) {
      setNote(e.message)
    }
    setBusy(null)
  }

  /* 2 — upload, then the message carries a link */
  async function sendLink() {
    setBusy('link'); setNote(null)
    try {
      const url = await uploadPdfForLink({ blob: await blob(), filename, bucket, folder })
      setLink(url)
      openWhatsApp(number, `${message}\n\nPurchase order PDF:\n${url}`)
      onSent?.('whatsapp')
      setNote(number
        ? `WhatsApp opened for ${numberLabel || 'the number on file'}. Press send.`
        : 'WhatsApp opened. Pick the chat or group, then press send.')
    } catch (e) {
      setNote('Could not upload: ' + e.message)
    }
    setBusy(null)
  }

  /* 3 — just give me the file */
  async function download() {
    setBusy('save'); setNote(null)
    try {
      saveBlob(await blob(), filename)
      setNote('Saved. Attach it in WhatsApp yourself.')
    } catch (e) { setNote(e.message) }
    setBusy(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
      onClick={onClose}>
      <div className="safe-b max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-xl
                      bg-white p-5 shadow-pop md:rounded-xl"
        onClick={e => e.stopPropagation()}>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-sm text-slate2">Close</button>
        </div>

        <div className="space-y-2.5">
          {canAttach ? (
            <>
              <button className="btn-dark w-full" disabled={!!busy} onClick={attach}>
                {busy === 'attach' ? 'Preparing' : 'Attach PDF and send on WhatsApp'}
              </button>
              <p className="px-1 text-2xs text-slate2">
                Opens your phone's share sheet with the PDF attached. Pick WhatsApp,
                then the chat or group. They receive a document, not a link.
              </p>
            </>
          ) : (
            <p className="rounded-md bg-paper px-3 py-2.5 text-xs text-slate2">
              This browser cannot attach a file to a share. On a phone it can — or
              use the link below, which works everywhere.
            </p>
          )}

          <div className="pt-1">
            <button className={(canAttach ? 'btn-ghost' : 'btn-dark') + ' w-full'}
              disabled={!!busy} onClick={sendLink}>
              {busy === 'link' ? 'Uploading' : 'Send as a link on WhatsApp'}
            </button>
            <p className="mt-1 px-1 text-2xs text-slate2">
              Uploads the PDF and puts a link in the message. Works on a laptop, and
              it is the only way to send to a group.
              {number ? ` Goes to ${numberLabel || number}.` : ' You pick the chat.'}
            </p>
          </div>

          <div className="pt-1">
            <button className="btn-ghost w-full" disabled={!!busy} onClick={download}>
              {busy === 'save' ? 'Saving' : 'Download only'}
            </button>
          </div>
        </div>

        {note && (
          <div className="mt-4 rounded-md bg-paper px-3 py-2.5 text-sm text-ink">{note}</div>
        )}

        {link && (
          <div className="mt-3">
            <label>The link, if you need it again</label>
            <div className="flex gap-2">
              <input readOnly value={link} onFocus={e => e.target.select()} />
              <button className="btn-ghost shrink-0"
                onClick={async () => setNote(await copyText(link)
                  ? 'Link copied.' : 'Could not copy — select it and copy by hand.')}>
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
