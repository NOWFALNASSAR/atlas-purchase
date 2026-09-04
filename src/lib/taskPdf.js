import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { dt, dtTime } from './db'

/* A task as a one-page document, for sending to a department that
   wants it on paper or in a WhatsApp message. */

export function buildTaskPdf(t, points = [], notes = [], events = [], mrf = null,
                             company = 'Atlas Maharani Group') {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  doc.setFont('helvetica', 'bold').setFontSize(15)
  doc.text(company, 40, 44)
  doc.setFont('helvetica', 'normal').setFontSize(11)
  doc.text(t.title || 'Task', 40, 64)
  doc.setFontSize(9).setTextColor(120)
  doc.text(`${t.task_no}  ·  generated ${new Date().toLocaleString('en-IN')}`, 40, 79)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 96,
    body: [
      ['Raised by', t.from_dept_name + (t.raised_by_name ? ` (${t.raised_by_name})` : '')],
      ['Answerable', t.to_dept_name + (t.assigned_to_name ? ` (${t.assigned_to_name})` : '')],
      ['Raised on', dt(t.created_at)],
      ['Needed by', t.due_date ? dt(t.due_date) : '—'],
      ['Promised finish', t.planned_finish ? dt(t.planned_finish) : 'not set'],
      ['Status', t.status],
      ['Priority', t.priority]
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 0: { cellWidth: 130, textColor: [91, 104, 121] },
                    1: { fontStyle: 'bold' } }
  })

  if (t.details) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      head: [['What needs doing']],
      body: [[t.details]],
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [14, 27, 46], fontSize: 10 }
    })
  }

  if (mrf) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      head: [['Manpower request', '']],
      body: [
        ['Position', mrf.position],
        ['How many', String(mrf.headcount)],
        ['Type', (mrf.employment || '').replace('_', ' ')],
        ['Salary', [mrf.salary_min, mrf.salary_max].filter(Boolean)
          .map(v => '₹' + Number(v).toLocaleString('en-IN')).join(' to ')
          + (mrf.salary_period ? ' per ' + mrf.salary_period : '')],
        ['Needed by', mrf.expected_by ? dt(mrf.expected_by) : '—'],
        ['Qualification', mrf.qualification || '—'],
        ['Experience', mrf.experience || '—']
      ],
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [169, 119, 43], fontSize: 10 },
      columnStyles: { 0: { cellWidth: 130 } }
    })
  }

  if (points.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      head: [['#', 'Sub-point', 'Done']],
      body: points.map((p, i) => [i + 1, p.label, p.done ? 'Yes' : '']),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [14, 27, 46], fontSize: 9 },
      columnStyles: { 0: { cellWidth: 26 }, 2: { cellWidth: 50, halign: 'center' } }
    })
  }

  if (notes.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      head: [['Notes']],
      body: notes.map(n => [
        `${n.note}\n${n.profiles?.full_name || ''} · ${dtTime(n.created_at)}`
      ]),
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [14, 27, 46], fontSize: 10 }
    })
  }

  if (events.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      head: [['History', 'Who', 'When']],
      body: events.map(e => [
        e.action.replace(/_/g, ' ') + (e.note ? ` — ${e.note}` : ''),
        e.actor_name || 'system',
        dtTime(e.created_at)
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [91, 104, 121], fontSize: 9 }
    })
  }

  return {
    blob: doc.output('blob'),
    filename: `${(t.task_no || 'task').replace(/\//g, '-')}.pdf`
  }
}
