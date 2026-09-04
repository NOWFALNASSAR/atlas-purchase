import { db } from './db'

/* ==================================================================
   SENDING A PDF TO WHATSAPP

   There are exactly two ways to do this from a web app, and they suit
   different situations. Both are here.

   1. THE SHARE SHEET — attaches the real file.

      navigator.share() with a files array opens the phone's own share
      sheet with WhatsApp in it, and the PDF goes as a genuine
      attachment. Works on Android Chrome and on iOS Safari. This is
      what you want on a phone: the supplier receives a document, not
      a link.

      It does NOT work on desktop Chrome or Firefox, and it cannot
      target a group directly — the person picks the chat.

   2. THE LINK — works everywhere.

      Upload the PDF, put a signed link in the message, open wa.me with
      the supplier's number. One tap for us, one tap for them. This is
      the only option on a laptop, and the only one that works for
      groups.

   What is NOT possible: putting a file into a wa.me link. WhatsApp has
   never supported it. Anyone who tells you otherwise is describing the
   Business API, which needs a provider and Meta approval.
   ================================================================== */

/** Can this device attach a file to a share? */
export function canShareFiles() {
  try {
    if (!navigator.canShare || !navigator.share) return false
    const probe = new File([new Blob(['x'], { type: 'application/pdf' })], 'x.pdf',
      { type: 'application/pdf' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/**
 * Open the share sheet with the PDF attached.
 * Returns 'shared' | 'cancelled' | 'unsupported'
 */
export async function sharePdfFile({ blob, filename, text, title }) {
  if (!canShareFiles()) return 'unsupported'

  const file = new File([blob], filename, { type: 'application/pdf' })

  try {
    await navigator.share({ files: [file], text, title })
    return 'shared'
  } catch (err) {
    // AbortError is the person closing the sheet, not a failure
    if (err?.name === 'AbortError') return 'cancelled'
    return 'unsupported'
  }
}

/**
 * Upload a PDF and get a link the recipient can open without signing in.
 *
 * A signed link rather than a public one: the path would be hard to
 * guess, but "hard to guess" is not a permission. This expires, and
 * until then only somebody holding the link can open it.
 */
export async function uploadPdfForLink({
  blob, filename, bucket = 'po-pdfs', folder = 'shared', days = 180
}) {
  const path = `${folder}/${crypto.randomUUID()}-${filename}`

  const up = await db.storage.from(bucket)
    .upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw up.error

  const signed = await db.storage.from(bucket)
    .createSignedUrl(path, days * 86400, { download: filename })

  if (signed.error) {
    // bucket is public — fall back to the plain URL
    const { data } = db.storage.from(bucket).getPublicUrl(path, { download: filename })
    if (data?.publicUrl) return data.publicUrl
    throw signed.error
  }

  return signed.data.signedUrl
}

/* ---------- WhatsApp ---------- */

export const waNumber = n => {
  const d = String(n || '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 10) return '91' + d
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1)
  return d
}

export function openWhatsApp(number, text) {
  const n = waNumber(number)
  const url = n
    ? `https://wa.me/${n}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`
  window.open(url, '_blank', 'noopener')
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
