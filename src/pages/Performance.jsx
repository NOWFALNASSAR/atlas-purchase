import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db, num } from '../lib/db'
import SendPdfSheet from '../components/SendPdfSheet'

/* ==================================================================
   DEPARTMENT PERFORMANCE

   A score nobody can take apart is a score nobody believes. So the
   breakdown is always one tap away: which component, how many out of
   how many, how many points that earned.

   Nothing here is typed by anyone. Every figure comes from something
   that already happened — a timestamp, an attachment, a date met or
   missed.
   ================================================================== */

const PERIODS = [
  ['30',  'Last 30 days'],
  ['90',  'Last 3 months'],
  ['180', 'Last 6 months'],
  ['365', 'Last year']
]

const BAND = {
  strong:            ['Strong',          'bg-good text-white',      'text-good'],
  steady:            ['Steady',          'bg-good/15 text-good',    'text-good'],
  'needs attention': ['Needs attention', 'bg-warn/20 text-warn',    'text-warn'],
  poor:              ['Poor',            'bg-bad/10 text-bad',      'text-bad'],
  'not measured':    ['No work yet',     'bg-line text-slate2',     'text-slate2']
}

export default function Performance() {
  const [days, setDays] = useState('30')
  const [rows, setRows] = useState([])
  const [pick, setPick] = useState(null)
  const [parts, setParts] = useState([])
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(null)
  const [sending, setSending] = useState(false)

  const range = () => {
    const to = new Date()
    const from = new Date()
    from.setDate(to.getDate() - Number(days))
    return { p_from: from.toISOString().slice(0, 10), p_to: to.toISOString().slice(0, 10) }
  }

  useEffect(() => { load() }, [days])
  useEffect(() => { if (pick) loadOne(pick.department_id) }, [pick?.department_id, days])

  async function load() {
    setLoading(true)
    const { data, error } = await db.rpc('dept_scores', range())
    if (error) { setFailed(error.message); setLoading(false); return }
    setRows(data || [])
    setFailed(null)
    setLoading(false)
  }

  async function loadOne(id) {
    const [p, f] = await Promise.all([
      db.rpc('dept_score_parts', { p_dept: id, ...range() }),
      db.rpc('dept_findings', { p_dept: id, ...range() })
    ])
    setParts(p.data || [])
    setFindings(f.data || [])
  }

  const strengths = findings.filter(f => f.kind === 'strength')
    .sort((a, b) => b.metric - a.metric).slice(0, 5)
  const improves = findings.filter(f => f.kind === 'improve')
    .sort((a, b) => a.metric - b.metric).slice(0, 5)

  /* ---------- PDF ---------- */

  function buildPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const label = PERIODS.find(p => p[0] === days)?.[1]

    doc.setFont('helvetica', 'bold').setFontSize(15)
    doc.text('Department performance', 40, 44)
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(120)
    doc.text(`${label} · generated ${new Date().toLocaleString('en-IN')}`, 40, 62)
    doc.setTextColor(0)

    if (pick) {
      doc.setFont('helvetica', 'bold').setFontSize(13)
      doc.text(`${pick.name} — ${num(pick.score, 1)} out of 10`, 40, 90)
      doc.setFont('helvetica', 'normal')

      autoTable(doc, {
        startY: 104,
        head: [['Component', 'Result', 'Weight', 'Points']],
        body: parts.map(p => [
          p.label,
          p.denominator > 0 ? `${p.numerator} of ${p.denominator}  (${num(p.rate * 100)}%)` : 'nothing to measure',
          num(p.weight, 0),
          p.points == null ? '—' : num(p.points, 2)
        ]),
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [14, 27, 46], fontSize: 9 }
      })

      const list = (title, arr, colour) => {
        if (!arr.length) return
        autoTable(doc, {
          startY: doc.lastAutoTable.finalY + 16,
          head: [[title]],
          body: arr.map((f, i) => [`${i + 1}.  ${f.finding}`]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: colour, fontSize: 10 }
        })
      }
      list('Strengths', strengths, [18, 112, 78])
      list('Areas to improve', improves, [164, 54, 43])
    } else {
      autoTable(doc, {
        startY: 84,
        head: [['Department', 'Tasks', 'Score', 'Band']],
        body: rows.map(r => [
          r.name + (r.kind === 'showroom' ? '  (showroom)' : ''),
          r.tasks,
          r.score == null ? '—' : num(r.score, 1),
          BAND[r.band]?.[0] || r.band
        ]),
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [14, 27, 46], fontSize: 9 },
        alternateRowStyles: { fillColor: [246, 248, 250] }
      })
    }

    return doc
  }

  if (failed) return (
    <div className="page page-xl py-10">
      <div className="card border-bad/30 bg-bad/[.04] p-5 text-sm text-bad">
        <div className="font-semibold">Could not load performance</div>
        <div className="mt-0.5">{failed}</div>
        <p className="mt-2 text-xs">
          If this mentions dept_scores, run supabase/36_performance.sql in Supabase.
        </p>
      </div>
    </div>
  )

  /* ---------- one department ---------- */

  if (pick) {
    const band = BAND[pick.band] || BAND['not measured']
    return (
      <div className="page page-lg space-y-5">
        <button onClick={() => setPick(null)} className="text-sm font-medium text-slate2">
          All departments
        </button>

        <div className="card overflow-hidden">
          <div className="bg-ink p-5 text-white">
            <div className="text-sm text-white/60">{pick.name}</div>
            <div className="mt-1 flex items-end gap-3">
              <span className="text-4xl font-semibold tracking-tight">
                {pick.score == null ? '—' : num(pick.score, 1)}
              </span>
              <span className="mb-1 text-lg text-white/50">/ 10</span>
              <span className={'mb-1.5 ml-auto tag ' + band[1]}>{band[0]}</span>
            </div>
            <div className="mt-1 text-2xs text-white/50">
              {pick.tasks} task{pick.tasks === 1 ? '' : 's'} in this period
              {pick.measured < 10 && ` · ${num(pick.measured, 0)} of 10 points measurable`}
            </div>
          </div>

          {pick.measured < 10 && (
            <div className="border-t border-line bg-paper px-4 py-2.5 text-xs text-slate2">
              Some components had nothing to measure, so their weight was dropped and
              the rest scaled back up to ten. A quiet month should not look like a bad
              one.
            </div>
          )}
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold">How the score is made up</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2.5 text-left">Component</th>
                  <th className="px-3 py-2.5 text-right">Result</th>
                  <th className="px-3 py-2.5 text-right">Weight</th>
                  <th className="px-4 py-2.5 text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {parts.map(p => (
                  <tr key={p.component} className="border-t border-line">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.label}</div>
                      <div className="text-2xs text-slate2">{p.hint}</div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {p.denominator > 0 ? (
                        <>
                          <div className={'font-semibold ' +
                            (p.rate >= 0.85 ? 'text-good'
                             : p.rate < 0.7 ? 'text-bad' : '')}>
                            {num(p.rate * 100)}%
                          </div>
                          <div className="text-2xs text-slate2">
                            {p.numerator} of {p.denominator}
                          </div>
                        </>
                      ) : <span className="text-2xs text-slate2">nothing to measure</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-slate2">{num(p.weight, 0)}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {p.points == null ? '—' : num(p.points, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Findings title="Strengths" items={strengths} good
            empty="Nothing reached 85% in this period." />
          <Findings title="Areas to improve" items={improves}
            empty="Nothing fell below 70%. Good period." />
        </div>

        <button className="btn-dark w-full" onClick={() => setSending(true)}>
          Send this report
        </button>

        {sending && (
          <SendPdfSheet
            title={'Send ' + pick.name + ' performance'}
            filename={`${pick.name} performance ${new Date().toISOString().slice(0, 10)}.pdf`}
            message={`*${pick.name} — performance*\n${num(pick.score, 1)} out of 10\n\n` +
              (strengths.length ? `*Strengths*\n${strengths.map(s => '• ' + s.finding).join('\n')}\n\n` : '') +
              (improves.length ? `*To improve*\n${improves.map(s => '• ' + s.finding).join('\n')}\n` : '') +
              `\nFull report attached.`}
            build={() => buildPdf().output('blob')}
            bucket="po-pdfs" folder={'performance/' + pick.department_id}
            onClose={() => setSending(false)}
          />
        )}
      </div>
    )
  }

  /* ---------- all departments ---------- */

  const scored = rows.filter(r => r.score != null)
  const avg = scored.length
    ? scored.reduce((s, r) => s + Number(r.score), 0) / scored.length : null

  return (
    <div className="page page-xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Performance</h1>
          <p className="text-sm text-slate2">
            Out of ten, from what actually happened. Open a department to see the
            working.
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => buildPdf().save('Performance.pdf')}>
          PDF
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map(([k, l]) => (
          <button key={k} onClick={() => setDays(k)}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' +
              (days === k ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
            {l}
          </button>
        ))}
      </div>

      {loading ? <div className="card h-64 animate-pulse bg-line2" /> : (
        <>
          {avg != null && (
            <div className="card grid grid-cols-2 divide-x divide-line sm:grid-cols-4">
              <Cell label="Average score" value={num(avg, 1)} />
              <Cell label="Strong" value={rows.filter(r => r.band === 'strong').length} />
              <Cell label="Needs attention"
                value={rows.filter(r => r.band === 'needs attention').length} />
              <Cell label="Poor" value={rows.filter(r => r.band === 'poor').length}
                bad={rows.some(r => r.band === 'poor')} />
            </div>
          )}

          <ul className="card divide-y divide-line">
            {rows.map(r => {
              const band = BAND[r.band] || BAND['not measured']
              return (
                <li key={r.department_id}>
                  <button onClick={() => setPick(r)}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-paper">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{r.name}</span>
                      <span className="block text-2xs text-slate2">
                        {r.kind === 'showroom' ? 'Showroom · ' : ''}
                        {r.tasks} task{r.tasks === 1 ? '' : 's'}
                      </span>
                    </span>

                    {r.score != null && (
                      <span className="hidden w-40 sm:block">
                        <span className="block h-1.5 rounded-full bg-line2">
                          <span className={'block h-1.5 rounded-full ' +
                            (r.score >= 8.5 ? 'bg-good'
                             : r.score >= 7 ? 'bg-good/60'
                             : r.score >= 5 ? 'bg-warn' : 'bg-bad')}
                            style={{ width: (r.score * 10) + '%' }} />
                        </span>
                      </span>
                    )}

                    <span className={'w-14 text-right text-lg font-semibold ' + band[2]}>
                      {r.score == null ? '—' : num(r.score, 1)}
                    </span>
                    <span className={'hidden shrink-0 tag sm:inline-flex ' + band[1]}>
                      {band[0]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <p className="text-2xs text-slate2">
            Weights: finishing on time 3, progress updates 2, and one each for
            accepting work, committing a date, evidence, recurring work and first
            time right. Change them in the performance_weights table.
          </p>
        </>
      )}
    </div>
  )
}

function Findings({ title, items, good, empty }) {
  return (
    <section>
      <h2 className={'mb-2 text-sm font-semibold ' + (good ? 'text-good' : 'text-bad')}>
        {title}
      </h2>
      {items.length === 0 ? (
        <div className="card p-5 text-sm text-slate2">{empty}</div>
      ) : (
        <ol className="card divide-y divide-line">
          {items.map((f, i) => (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className={'grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-bold ' +
                (good ? 'bg-good/15 text-good' : 'bg-bad/10 text-bad')}>
                {i + 1}
              </span>
              <span className="text-sm">{f.finding}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Cell({ label, value, bad }) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={'text-xl font-semibold ' + (bad ? 'text-bad' : '')}>{value}</div>
    </div>
  )
}
