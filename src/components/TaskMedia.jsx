import { useEffect, useRef, useState } from 'react'
import { db, compressImage } from '../lib/db'

/** Photos and voice notes on a task. Voice records straight in the browser. */
export default function TaskMedia({ taskId, editable }) {
  const [rows, setRows] = useState([])
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef(null)
  const chunks = useRef([])
  const timer = useRef(null)

  useEffect(() => { load() }, [taskId])
  useEffect(() => () => { clearInterval(timer.current) }, [])

  async function load() {
    const { data } = await db.from('task_attachments').select('*')
      .eq('task_id', taskId).order('created_at')
    setRows(data || [])
    const u = {}
    for (const r of data || []) {
      const { data: s } = await db.storage.from('task-media').createSignedUrl(r.path, 3600)
      u[r.id] = s?.signedUrl
    }
    setUrls(u)
  }

  async function upload(blob, kind, ext, secs) {
    const path = `${taskId}/${crypto.randomUUID()}.${ext}`
    const { error } = await db.storage.from('task-media').upload(path, blob, {
      contentType: blob.type || (kind === 'voice' ? 'audio/webm' : 'image/jpeg')
    })
    if (error) throw error
    await db.from('task_attachments').insert({
      task_id: taskId, kind, path, seconds: secs || null
    })
    await load()
  }

  async function addPhotos(files) {
    setBusy(true)
    try {
      for (const f of Array.from(files)) {
        const small = await compressImage(f)
        await upload(small, 'photo', 'jpg')
      }
    } catch (e) { alert('Photo did not upload: ' + e.message) }
    setBusy(false)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => e.data.size && chunks.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        clearInterval(timer.current)
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        setBusy(true)
        try { await upload(blob, 'voice', 'webm', seconds) }
        catch (e) { alert('Voice note did not upload: ' + e.message) }
        setBusy(false); setSeconds(0)
      }
      rec.current = mr
      mr.start()
      setRecording(true); setSeconds(0)
      timer.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } catch (e) {
      alert('Could not use the microphone. Allow microphone access and try again.')
    }
  }

  function stopRecording() {
    rec.current?.stop()
    setRecording(false)
  }

  async function remove(r) {
    if (!confirm('Remove this?')) return
    await db.storage.from('task-media').remove([r.path])
    await db.from('task_attachments').delete().eq('id', r.id)
    load()
  }

  const photos = rows.filter(r => r.kind === 'photo')
  const voices = rows.filter(r => r.kind === 'voice')

  return (
    <div className="space-y-3">
      {(photos.length > 0 || editable) && (
        <div className="flex flex-wrap gap-2">
          {photos.map(r => (
            <div key={r.id} className="relative">
              <a href={urls[r.id]} target="_blank" rel="noreferrer">
                <img src={urls[r.id]} alt="task photo"
                  className="h-20 w-20 rounded-md border border-line object-cover" />
              </a>
              {editable && (
                <button onClick={() => remove(r)} aria-label="Remove"
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-bad text-[11px] font-bold text-white">×</button>
              )}
            </div>
          ))}
          {editable && (
            <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center
                              rounded-md border border-dashed border-line bg-paper text-[11px] font-semibold text-slate2">
              {busy ? 'Wait' : '+ Photo'}
              <input type="file" accept="image/*" multiple capture="environment" className="hidden"
                onChange={e => e.target.files.length && addPhotos(e.target.files)} />
            </label>
          )}
        </div>
      )}

      {voices.map(r => (
        <div key={r.id} className="flex items-center gap-2 rounded-md border border-line p-2">
          <audio controls src={urls[r.id]} className="h-8 flex-1" />
          {r.seconds ? <span className="text-[11px] text-slate2">{r.seconds}s</span> : null}
          {editable && (
            <button onClick={() => remove(r)} className="text-xs font-bold text-bad">×</button>
          )}
        </div>
      ))}

      {editable && (
        recording ? (
          <button type="button" onClick={stopRecording}
            className="btn-bad w-full">
            ● Recording {seconds}s — tap to stop
          </button>
        ) : (
          <button type="button" onClick={startRecording} disabled={busy}
            className="btn-ghost w-full">
            🎤 Record a voice note
          </button>
        )
      )}
    </div>
  )
}
