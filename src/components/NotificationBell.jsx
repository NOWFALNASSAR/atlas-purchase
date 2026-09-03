import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, dtTime } from '../lib/db'

/* ==================================================================
   NOTIFICATIONS

   The database writes these on a trigger whenever a task is raised,
   disputed, completed or closed. This just reads them.

   It polls every 60 seconds rather than holding a realtime socket
   open. On shop wifi a dropped socket that silently stops delivering
   is worse than a check that is up to a minute late.
   ================================================================== */

const POLL_MS = 60000

export default function NotificationBell() {
  const nav = useNavigate()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [missing, setMissing] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    load()
    timer.current = setInterval(load, POLL_MS)
    return () => clearInterval(timer.current)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  async function load() {
    const { data, error } = await db.from('notifications')
      .select('*').order('created_at', { ascending: false }).limit(30)

    // Table not there yet — the migration has not been run. Hide quietly
    // rather than putting an error in the header of every page.
    if (error) { setMissing(true); clearInterval(timer.current); return }

    setItems(data || [])
    setUnread((data || []).filter(n => !n.read_at).length)
  }

  async function markAllRead() {
    await db.rpc('mark_notifications_read', { p_ids: null })
    setUnread(0)
    setItems(x => x.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
  }

  async function openItem(n) {
    setOpen(false)
    if (!n.read_at) {
      await db.rpc('mark_notifications_read', { p_ids: [n.id] })
      setUnread(u => Math.max(0, u - 1))
    }
    if (n.link) nav(n.link)
  }

  if (missing) return null

  return (
    <div className="relative">
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="btn-quiet relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" className="h-[19px] w-[19px]">
          <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5Z" />
          <path d="M13.7 19.5a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center
                           rounded-full bg-gold px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div onClick={e => e.stopPropagation()}
          className="absolute right-0 z-40 mt-2 w-[19rem] overflow-hidden rounded-lg border
                     border-line bg-white shadow-pop sm:w-80">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs font-medium text-gold" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-[24rem] overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate2">
                Nothing yet. You will be told here when a task is sent to your
                department or comes back to you.
              </li>
            )}
            {items.map(n => (
              <li key={n.id} className="border-b border-line last:border-0">
                <button onClick={() => openItem(n)}
                  className={'flex w-full gap-2.5 px-4 py-3 text-left hover:bg-paper ' +
                    (n.read_at ? '' : 'bg-gold2/60')}>
                  <span className={'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ' +
                    (n.read_at ? 'bg-line' : 'bg-gold')} />
                  <span className="min-w-0 flex-1">
                    <span className={'block text-sm ' + (n.read_at ? '' : 'font-semibold')}>
                      {n.title}
                    </span>
                    {n.body && <span className="block text-xs text-slate2">{n.body}</span>}
                    <span className="block text-2xs text-mute">{dtTime(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
