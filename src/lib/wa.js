import { dt } from './db'

/* ==================================================================
   WHATSAPP

   What is possible without the Business API, and what is not.

   TO A PERSON OR A DEPARTMENT NUMBER — works. wa.me opens WhatsApp
   with the message already typed. One tap to send.

   TO A GROUP — not possible from a link. WhatsApp has never allowed
   a URL to target a group; there is no group address. So for the HOD
   group the app copies the message to the clipboard and, where the
   phone supports it, opens the share sheet with WhatsApp in it. You
   pick the group and paste. Two taps instead of one.

   ATTACHING A PDF — a link cannot carry a file either. The PDF
   downloads, and you attach it in WhatsApp yourself.

   Automating both of those needs a WhatsApp Business API provider
   (Interakt, AiSensy, Gupshup, WATI) and Meta template approval, which
   takes a week or two. Until then this is one tap short of automatic,
   and it works today.
   ================================================================== */

/** 10 digits, no +91, no spaces — the format the supplier master already uses. */
export const waNumber = n => {
  const d = String(n || '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 10) return '91' + d
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1)
  return d
}

export const waLink = (number, text) => {
  const n = waNumber(number)
  return n
    ? `https://wa.me/${n}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`
}

export function openWhatsApp(number, text) {
  window.open(waLink(number, text), '_blank', 'noopener')
}

/** Copy, and offer the share sheet if the phone has one. */
export async function shareOrCopy(text, title = 'Atlas') {
  try {
    if (navigator.share) {
      await navigator.share({ title, text })
      return 'shared'
    }
  } catch {
    // the person dismissed the share sheet — fall through to copying
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/* ---------- the messages ------------------------------------------ */

const line = (label, value) => (value ? `${label}: ${value}\n` : '')

/** One task, sent to the department that has to do it. */
export function taskMessage(t, mrf) {
  let m = `*${t.title}*\n${t.task_no}\n\n`
  m += line('From', t.from_dept_name)
  m += line('For', t.to_dept_name)
  m += line('Person', t.assigned_to_name)
  m += line('Priority', t.priority !== 'normal' ? t.priority.toUpperCase() : null)
  m += line('Needed by', t.due_date ? dt(t.due_date) : null)

  if (t.details) m += `\n${t.details}\n`

  if (mrf) {
    m += `\n*Manpower request*\n`
    m += line('Position', mrf.position)
    m += line('How many', mrf.headcount)
    m += line('Type', (mrf.employment || '').replace('_', ' '))
    if (mrf.salary_min || mrf.salary_max) {
      const r = [mrf.salary_min, mrf.salary_max].filter(Boolean)
        .map(v => '₹' + Number(v).toLocaleString('en-IN')).join(' to ')
      m += line('Salary', `${r} per ${mrf.salary_period}`)
    }
    m += line('Needed by', mrf.expected_by ? dt(mrf.expected_by) : null)
    m += line('Qualification', mrf.qualification)
    m += line('Experience', mrf.experience)
    m += line('Replacing', mrf.replacing)
    m += line('Why', mrf.reason)
  }

  m += `\nAtlas`
  return m
}

/** The end of day, for the HOD group. */
export function eodMessage(rows, company = 'Atlas') {
  const today = new Date().toLocaleDateString('en-IN',
    { weekday: 'short', day: 'numeric', month: 'short' })

  const priority = rows.filter(r => r.mark === 'priority')
  const skipped  = rows.filter(r => r.mark === 'skipped')
  const done     = rows.filter(r => r.closed_today || r.completed_today || r.mark === 'done_today')
  const overdue  = rows.filter(r => r.overdue && r.mark !== 'skipped')
  const raised   = rows.filter(r => r.raised_today)

  const list = (arr, withDept = true) => arr.map(r =>
    `• ${r.title}${withDept ? ` — ${r.to_dept_name}` : ''}` +
    (r.overdue ? ` _(${r.days_open}d late)_` : '') +
    (r.mark_note ? `\n   ${r.mark_note}` : '')
  ).join('\n')

  let m = `*${company} — end of day*\n${today}\n\n`

  m += `Raised today: ${raised.length}\n`
  m += `Finished today: ${done.length}\n`
  m += `Still open: ${rows.filter(r => !r.closed_today).length}\n`
  m += `Overdue: ${overdue.length}\n`

  if (priority.length) m += `\n*Priority for today (${priority.length})*\n${list(priority)}\n`
  if (done.length)     m += `\n*Finished (${done.length})*\n${list(done)}\n`
  if (overdue.length)  m += `\n*Overdue (${overdue.length})*\n${list(overdue)}\n`
  if (skipped.length)  m += `\n*Left for tomorrow (${skipped.length})*\n${list(skipped)}\n`

  if (!priority.length && !done.length && !overdue.length) {
    m += `\nNothing marked today.\n`
  }

  m += `\nFull report attached.`
  return m
}
