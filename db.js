import { createClient } from '@supabase/supabase-js'

/* If either setting is missing, createClient throws the moment this file
   loads — before React starts — and the browser shows a blank white page
   with no clue why. So check first, and let main.jsx put a readable
   message on the screen instead. */

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)

export const missingSetting =
  !url && !key ? 'both settings' : !url ? 'VITE_SUPABASE_URL' : !key ? 'VITE_SUPABASE_ANON_KEY' : null

export const db = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-key'
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

/* Fixed-decimal formatting that cannot throw.

   Calling .toFixed() on a value that turned out to be undefined takes
   down the whole page — React unmounts the tree and the screen goes
   blank. That is a heavy price for one missing figure. A view returns
   null, a sync has not run, a branch has no target: any of those is
   enough. Use this anywhere a figure comes from the database.

   num(x)          -> '0'      when x is undefined, null or not a number
   num(12.345, 1)  -> '12.3'
   num(null, 1, '—') -> '—'                                            */
export const num = (v, decimals = 0, fallback = null) => {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || Number.isNaN(n))
    return fallback ?? (0).toFixed(decimals)
  return n.toFixed(decimals)
}

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
