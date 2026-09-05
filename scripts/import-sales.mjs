/* ==================================================================
   ATLAS — import a day's sales

   Reads the four exports for one branch and one day, reconciles them,
   and writes SQL you paste into Supabase.

     node scripts/import-sales.mjs BILLWISE.xlsx ITEMWISE.xls SALESMANWISE.xls

   The day and the branch are taken from BILLWISE, so nothing has to be
   typed. If the item file and the bill file disagree on the ex-tax
   total by more than a rupee it says so loudly — a file exported
   mid-trading will otherwise quietly understate the day.
   ================================================================== */

import * as XLSX from 'xlsx'
import { writeFileSync, readFileSync } from 'fs'

const read = p => XLSX.read(readFileSync(p), { type: 'buffer', cellDates: true })
const [billPath, itemPath, manPath] = process.argv.slice(2)
if (!billPath) {
  console.error('\n  node scripts/import-sales.mjs BILLWISE.xlsx [ITEMWISE.xls] [SALESMANWISE.xls]\n')
  process.exit(1)
}

const q = v => v === null || v === undefined || v === '' ? 'null'
  : `'${String(v).replace(/'/g, "''")}'`
const n = v => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : 0 }

/* the bill date arrives as '04/09/26 09:50:14' — day first */
function billDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{2})/)
  if (!m) return null
  return `20${m[3]}-${m[2]}-${m[1]}`
}

/* 'raheena-9747805085,' -> name and phone.

   Most bills say 'General', which is the till's word for a walk-in, not
   somebody's name. Storing 186 customers called General would ruin every
   customer report, so it is treated as no customer at all.

   The phone is found anywhere in the string rather than only at the end,
   because the format is not consistent. */
const WALK_IN = new Set(['GENERAL', 'CASH', 'CUSTOMER', 'C', '-'])
function customer(raw) {
  const s = String(raw ?? '').replace(/,+$/, '').replace(/^,+/, '').trim()
  if (!s || WALK_IN.has(s.toUpperCase())) return { name: null, phone: null }

  const phone = (s.match(/(\d{10})/) || [])[1] || null
  let name = s.replace(/\d{10}/, '').replace(/[-,\s]+$/, '').replace(/^[-,\s]+/, '').trim()
  if (!name || WALK_IN.has(name.toUpperCase())) name = null
  return { name, phone }
}

/* ---------- bills ---------- */
const bills = XLSX.utils.sheet_to_json(read(billPath).Sheets[read(billPath).SheetNames[0]])
if (!bills.length) { console.error('  BILLWISE is empty'); process.exit(1) }

const date = billDate(bills[0].Date)
const branch = String(bills[0].BranchName ?? '').trim() || 'UNKNOWN'
if (!date) { console.error('  could not read the date from BILLWISE'); process.exit(1) }

let amount = 0, taxable = 0, tax = 0, live = 0
const billRows = bills.map(b => {
  const c = customer(b.Customer)
  const cancelled = String(b.Cncld ?? 'N').toUpperCase().startsWith('Y')
  const slabs = [3, 5, 12, 18, 28, 40].map(p => [n(b['Amt' + p]), n(b['VAT' + p])])
  const tx = slabs.reduce((s, [a]) => s + a, 0)
  const vt = n(b.VATTot) || slabs.reduce((s, [, v]) => s + v, 0)
  if (!cancelled) { amount += n(b.Amount); taxable += tx; tax += vt; live++ }
  return { b, c, cancelled, slabs, tx, vt }
})

/* ---------- items ---------- */
let items = [], itemTotal = 0, cost = 0, margin = 0, discount = 0, pieces = 0
if (itemPath) {
  const wb = read(itemPath)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })
  /* The last row is a totals line, shifted one column left — 720.75
     sits where a barcode belongs. Dropped by position, not by looking
     for the word Total: barcodes like 503377 are numbers too. */
  const body = rows.slice(1, -1)
  items = body
    .map(r => ({ barcode: String(r[0] ?? '').trim(), qty: n(r[1]), value: n(r[2]),
                 cost: n(r[4]), margin: n(r[5]), discount: n(r[9]) }))
    .filter(r => r.barcode)
  for (const r of items) {
    itemTotal += r.value; cost += r.cost; margin += r.margin
    discount += r.discount; pieces += r.qty
  }
}

/* ---------- salesmen ---------- */
let people = []
if (manPath) {
  const wb = read(manPath)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })
  people = rows.slice(1, -1)                 // last row is the totals line
    .map(r => {
      const d = String(r[0] ?? '').trim()
      const sp = d.indexOf(' ')
      return { code: sp > 0 ? d.slice(0, sp) : d,
               name: sp > 0 ? d.slice(sp + 1).trim() : null,
               qty: n(r[1]), value: n(r[2]), bills: n(r[3]) }
    })
    .filter(r => r.code)
}

/* ---------- do the three files agree? ---------- */
const variance = itemPath ? Math.round((itemTotal - taxable) * 100) / 100 : 0
const ok = Math.abs(variance) <= 1

console.log(`\n  ${branch}  ${date}`)
console.log(`  bills            ${live}`)
console.log(`  with tax         ${amount.toLocaleString('en-IN', {minimumFractionDigits:2})}`)
console.log(`  without tax      ${taxable.toLocaleString('en-IN', {minimumFractionDigits:2})}`)
console.log(`  tax              ${tax.toLocaleString('en-IN', {minimumFractionDigits:2})}`)
if (itemPath) {
  console.log(`  item file ex-tax ${itemTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}`)
  console.log(`  cost             ${cost.toLocaleString('en-IN', {minimumFractionDigits:2})}`)
  console.log(`  margin           ${margin.toLocaleString('en-IN', {minimumFractionDigits:2})}` +
              `  (${(margin / itemTotal * 100).toFixed(1)}%)`)
  console.log(`  ${ok ? 'files agree' : `*** FILES DISAGREE by ${variance} ***`}`)
}
if (!ok) {
  console.log('\n  Not writing the SQL. Re-export both files after trading has')
  console.log('  finished for the day, then run this again.\n')
  process.exit(1)
}

/* ---------- the SQL ---------- */
const out = ['-- ' + branch + ' ' + date + ', generated ' + new Date().toISOString(), 'begin;']

// re-uploading a day replaces it
out.push(`delete from sales_bills         where branch_code = ${q(branch)} and bill_date = ${q(date)};`)
out.push(`delete from sales_barcode_daily where branch_code = ${q(branch)} and sale_date = ${q(date)};`)
out.push(`delete from sales_person_daily  where branch_code = ${q(branch)} and sale_date = ${q(date)};`)

const chunk = (arr, size, fn) => {
  for (let i = 0; i < arr.length; i += size) fn(arr.slice(i, i + size))
}

chunk(billRows, 200, part => out.push(
`insert into sales_bills (bill_date, branch_code, bill_no, invoice_no, form,
  customer_raw, customer_name, customer_phone, amount, taxable, tax_total, exempted,
  amt3, vat3, amt5, vat5, amt12, vat12, amt18, vat18, amt28, vat28, amt40, vat40,
  cancelled, user_code)
values\n  ` + part.map(({ b, c, cancelled, slabs, tx, vt }) =>
  `(${q(date)}, ${q(branch)}, ${q(String(b.No ?? '').trim())}, ${q(b.InvNo)}, ${q(b.Form)}, ` +
  `${q(b.Customer)}, ${q(c.name)}, ${q(c.phone)}, ${n(b.Amount)}, ${tx}, ${vt}, ${n(b.Exempted)}, ` +
  slabs.map(([a, v]) => `${a}, ${v}`).join(', ') + `, ${cancelled}, ${q(b.UserCode)})`
).join(',\n  ') + '\non conflict (branch_code, bill_date, bill_no) do nothing;'))

if (items.length) chunk(items, 300, part => out.push(
`insert into sales_barcode_daily (sale_date, branch_code, barcode, qty, value_extax,
  cost, margin, discount)
values\n  ` + part.map(r =>
  `(${q(date)}, ${q(branch)}, ${q(r.barcode)}, ${r.qty}, ${r.value}, ${r.cost}, ${r.margin}, ${r.discount})`
).join(',\n  ') + `
on conflict (branch_code, sale_date, barcode) do update
  set qty = excluded.qty, value_extax = excluded.value_extax, cost = excluded.cost,
      margin = excluded.margin, discount = excluded.discount;`))

if (people.length) chunk(people, 200, part => out.push(
`insert into sales_person_daily (sale_date, branch_code, person_code, person_name,
  qty, value_extax, bills, is_returns_counter)
values\n  ` + part.map(p =>
  `(${q(date)}, ${q(branch)}, ${q(p.code)}, ${q(p.name)}, ${p.qty}, ${p.value}, ` +
  `${Math.round(p.bills)}, ${p.value < 0})`
).join(',\n  ') + `
on conflict (branch_code, sale_date, person_code) do update
  set qty = excluded.qty, value_extax = excluded.value_extax, bills = excluded.bills;`))

/* fill in division, supplier and item from the barcodes we know */
out.push(`
update sales_barcode_daily s
   set item_id       = b.item_id,
       item_name     = coalesce(s.item_name, b.item_name),
       division_code = coalesce(s.division_code, b.division_code),
       supplier_code = coalesce(s.supplier_code, b.supplier_code)
  from barcodes b
 where s.branch_code = ${q(branch)} and s.sale_date = ${q(date)}
   and b.barcode = s.barcode;

update sales_bills b set branch_id = br.id
  from branches br
 where b.branch_code = ${q(branch)} and b.bill_date = ${q(date)}
   and upper(btrim(br.name)) = upper(btrim(${q(branch)}));`)

out.push(`
insert into sales_uploads (sale_date, branch_code, bills, amount, taxable, tax_total,
  cost, margin, discount, qty, reconciled, variance)
values (${q(date)}, ${q(branch)}, ${live}, ${amount.toFixed(2)}, ${taxable.toFixed(2)},
        ${tax.toFixed(2)}, ${cost.toFixed(2)}, ${margin.toFixed(2)}, ${discount.toFixed(2)},
        ${pieces}, ${ok}, ${variance})
on conflict (branch_code, sale_date) do update
  set bills = excluded.bills, amount = excluded.amount, taxable = excluded.taxable,
      tax_total = excluded.tax_total, cost = excluded.cost, margin = excluded.margin,
      discount = excluded.discount, qty = excluded.qty,
      reconciled = excluded.reconciled, variance = excluded.variance;`)

out.push('commit;')
out.push(`\nselect * from v_sales_day_full where sale_date = ${q(date)};`)

const file = `sales-${branch.toLowerCase().replace(/\W+/g, '-')}-${date}.sql`
writeFileSync(file, out.join('\n'))
console.log(`\n  ${file} written  (${(out.join('\n').length / 1024).toFixed(0)} KB)`)
console.log(`  paste it into Supabase -> SQL Editor\n`)
