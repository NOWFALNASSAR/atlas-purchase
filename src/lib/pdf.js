import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db, inr2, dt } from './db'

/**
 * Builds the supplier-facing PO.
 * po        : purchase_orders row (with supplier + entity joined)
 * items     : po_items rows
 * allocs    : po_item_allocations rows (with shops joined)
 * company   : settings.company value
 * returns   : { blob, filename }
 */
export function buildPoPdf(po, items, allocs = [], company = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40

  // header band
  doc.setFillColor(18, 32, 58)
  doc.rect(0, 0, W, 84, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold').setFontSize(16)
  doc.text(company.name || 'Atlas Maharani Group', M, 36)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text(company.address || '', M, 52)
  doc.text([company.phone, company.email].filter(Boolean).join('  •  '), M, 65)
  doc.setFont('helvetica', 'bold').setFontSize(13)
  doc.text('PURCHASE ORDER', W - M, 36, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(10)
  doc.text(po.po_no || 'DRAFT', W - M, 54, { align: 'right' })

  // parties
  doc.setTextColor(18, 32, 58)
  let y = 112
  doc.setFont('helvetica', 'bold').setFontSize(9)
  doc.text('SUPPLIER', M, y)
  doc.text('ORDER DETAILS', W / 2 + 10, y)
  doc.setFont('helvetica', 'normal').setFontSize(10)

  const sup = po.suppliers || {}
  const left = [sup.name, sup.company_name, sup.address, sup.gstin && 'GSTIN: ' + sup.gstin,
                sup.mobile && 'Mob: ' + sup.mobile].filter(Boolean)
  left.forEach((t, i) => doc.text(String(t), M, y + 16 + i * 13))

  const right = [
    'Date: ' + dt(po.submitted_at || po.created_at),
    'Entity: ' + (po.entities?.name || ''),
    'Type: ' + (po.purchase_type || '—'),
    'Expected delivery: ' + (po.expected_date ? dt(po.expected_date) : 'To confirm'),
    'Payment terms: ' + (sup.payment_terms || (sup.credit_days ? sup.credit_days + ' days' : '—')),
    ...(po.transporter ? ['Transporter: ' + po.transporter +
        (po.transporter_phone ? ' (' + po.transporter_phone + ')' : '')] : []),
    ...(po.lr_no ? ['LR / docket: ' + po.lr_no] : [])
  ]
  right.forEach((t, i) => doc.text(t, W / 2 + 10, y + 16 + i * 13))

  // items
  autoTable(doc, {
    startY: y + 16 + Math.max(left.length, right.length) * 13 + 14,
    head: [['#', 'Item', 'Model', 'Shop split', 'Qty', 'Rate', 'Tax', 'Amount']],
    body: items.map((it, i) => [
      i + 1,
      it.item_name,
      [it.model_no, it.colour, it.size].filter(Boolean).join(' / ') || '—',
      allocs.filter(a => a.po_item_id === it.id)
            .map(a => `${a.shops?.code} ${a.qty}`).join(', ') || 'Godown',
      it.qty,
      inr2(it.purchase_rate),
      (it.tax_rate || 0) + '%',
      inr2(it.line_purchase)
    ]),
    styles: { fontSize: 9, cellPadding: 5, lineColor: [223, 227, 234], lineWidth: 0.5 },
    headStyles: { fillColor: [18, 32, 58], textColor: 255, fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 92, fontSize: 7.5 },
      4: { halign: 'right', cellWidth: 34 },
      5: { halign: 'right', cellWidth: 52 },
      6: { halign: 'right', cellWidth: 32 },
      7: { halign: 'right', cellWidth: 62 }
    },
    margin: { left: M, right: M }
  })

  // shop-wise summary
  if (allocs.length) {
    const byShop = {}
    allocs.forEach(a => {
      const it = items.find(x => x.id === a.po_item_id)
      const k = a.shops?.code || '—'
      byShop[k] = byShop[k] || { name: a.shops?.name || '', qty: 0, val: 0 }
      byShop[k].qty += a.qty
      byShop[k].val += a.qty * Number(it?.purchase_rate || 0)
    })
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Shop', '', 'Pieces', 'Value']],
      body: Object.entries(byShop).sort().map(([code, v]) =>
        [code, v.name, v.qty, inr2(v.val)]),
      styles: { fontSize: 8.5, cellPadding: 4, lineColor: [223, 227, 234], lineWidth: 0.5 },
      headStyles: { fillColor: [74, 90, 115], textColor: 255, fontSize: 8 },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: M, right: M }
    })
  }

  let ey = doc.lastAutoTable.finalY + 16
  doc.setFont('helvetica', 'normal').setFontSize(9.5)
  doc.text('Total quantity: ' + po.total_qty, M, ey)

  const lines = [
    ['Value', inr2(po.total_purchase)],
    ['Tax', inr2(po.total_tax || 0)],
    ['Payable', inr2(po.grand_total || po.total_purchase)]
  ]
  lines.forEach(([k, v], i) => {
    const y = ey + i * 14
    const bold = i === lines.length - 1
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 11 : 9.5)
    doc.text(k, W - M - 90, y, { align: 'right' })
    doc.text(v, W - M, y, { align: 'right' })
  })
  ey += lines.length * 14 + 6

  if (po.delivery_address) {
    doc.setFont('helvetica', 'bold').setFontSize(9)
    doc.text('Deliver to:', M, ey)
    doc.setFont('helvetica', 'normal')
    doc.text(po.delivery_address, M + 54, ey, { maxWidth: W / 2 })
    ey += 16
  }

  if (po.remarks) {
    doc.setFont('helvetica', 'normal').setFontSize(9)
    doc.text('Remarks: ' + po.remarks, M, ey, { maxWidth: W - M * 2 })
    ey += 16
  }

  ey += 30
  doc.setFontSize(8.5).setTextColor(74, 90, 115)
  doc.text('Please confirm availability and delivery date against this order number.', M, ey)
  doc.text('Goods not matching the ordered specification are liable to be returned.', M, ey + 12)
  doc.text('This is a computer generated purchase order.', M, ey + 24)

  const filename = 'PO-' + (po.po_no || 'draft').replace(/[\/\\]/g, '-') + '.pdf'
  return { blob: doc.output('blob'), filename, doc }
}

/**
 * Uploads the PO PDF and returns a link the supplier can open.
 * WhatsApp cannot attach a file from a web page, so we send the link
 * instead — one tap and the supplier has the PDF.
 */
export async function uploadPoPdf(po, items, allocs, company) {
  const { blob, filename } = buildPoPdf(po, items, allocs, company)
  const path = `${po.id}/${crypto.randomUUID()}-${filename}`

  const { error } = await db.storage.from('po-pdfs')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (error) throw error

  // download: forces a real file save instead of opening in the browser viewer
  const { data } = db.storage.from('po-pdfs').getPublicUrl(path, { download: filename })
  const url = data.publicUrl

  await db.from('purchase_orders').update({ pdf_url: url }).eq('id', po.id)
  return url
}

export function downloadPoPdf(po, items, allocs, company) {
  const { blob, filename } = buildPoPdf(po, items, allocs, company)

  // Build the download ourselves rather than using doc.save(), so phone
  // browsers save the file instead of opening it in a preview tab.
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

/** Message text that goes with the PO on WhatsApp / email */
export function poMessage(po, company = {}, pdfUrl) {
  return (
    `Dear ${po.suppliers?.name || 'Supplier'},\n\n` +
    `Please find our Purchase Order ${po.po_no}.\n` +
    `Total quantity: ${po.total_qty}\n` +
    `Order value: ${inr2(po.grand_total || po.total_purchase)} (incl. tax)\n` +
    (po.expected_date ? `Expected delivery: ${dt(po.expected_date)}\n` : '') +
    (pdfUrl ? `\nPurchase order PDF:\n${pdfUrl}\n` : '') +
    `\nKindly confirm availability and delivery date.\n\n` +
    `${company.name || 'Atlas Maharani Group'}`
  )
}

export function whatsappLink(number, text) {
  const n = String(number || '').replace(/\D/g, '')
  const full = n.length === 10 ? '91' + n : n
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`
}
