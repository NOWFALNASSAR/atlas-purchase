import { createClient } from '@supabase/supabase-js'

export const db = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

/* ---------- money & numbers (Indian format) ---------- */
export const inr = n =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

export const inr2 = n =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const lakh = n => {
  const v = Number(n || 0)
  if (v >= 10000000) return '₹' + (v / 10000000).toFixed(2) + ' Cr'
  if (v >= 100000)   return '₹' + (v / 100000).toFixed(2) + ' L'
  return inr(v)
}

export const margin = (purchase, selling) =>
  selling > 0 ? +(((selling - purchase) / selling) * 100).toFixed(2) : 0

export const dt = s => (s ? new Date(s).toLocaleDateString('en-IN',
  { day: '2-digit', month: 'short', year: '2-digit' }) : '')

export const dtTime = s => (s ? new Date(s).toLocaleString('en-IN',
  { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/* ---------- status colours ---------- */
export const statusStyle = s => ({
  draft:     'bg-line text-slate2',
  pending:   'bg-gold/15 text-gold',
  approved:  'bg-good/15 text-good',
  sent:      'bg-ink/10 text-ink',
  confirmed: 'bg-good/15 text-good',
  partial:   'bg-gold/15 text-gold',
  rejected:  'bg-bad/10 text-bad',
  cancelled: 'bg-bad/10 text-bad',
  closed:    'bg-line text-slate2'
}[s] || 'bg-line text-slate2')

export const roleLabel = r => ({
  executive: 'Purchase Executive',
  manager:   'Purchase Manager',
  hod:       'Purchase HOD',
  accounts:  'Accounts',
  admin:     'Admin / MD'
}[r] || r)

/* ---------- photo compression --------------------------------------
   Shop wifi is slow. A 4 MB camera photo becomes ~150 KB before it
   ever leaves the phone. This one function saves the whole feature. */
export async function compressImage(file, maxSide = 1280, quality = 0.72) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', quality))
}

/* signed URL for a private storage object */
export async function photoUrl(path, seconds = 3600) {
  const { data } = await db.storage.from('po-photos').createSignedUrl(path, seconds)
  return data?.signedUrl
}
