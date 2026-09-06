/* ==================================================================
   READING A ZIP, AND WORKING OUT WHAT IS IN IT

   No zip library. The browser has DecompressionStream('deflate-raw'),
   which is all a zip actually needs — the rest is reading a directory
   at the end of the file. A library for this would be 40kB over shop
   wifi to do what the browser already does.
   ================================================================== */

/* ---------- the zip itself ---------- */

export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  /* The end-of-central-directory record sits at the end, after a
     comment of unknown length, so it is found by scanning backwards
     for its signature rather than by seeking to a fixed offset. */
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('This is not a zip file, or it is damaged')

  const count = view.getUint16(eocd + 10, true)
  let off = view.getUint32(eocd + 16, true)
  const out = []

  for (let i = 0; i < count; i++) {
    if (view.getUint32(off, true) !== 0x02014b50) break
    const method = view.getUint16(off + 10, true)
    const csize  = view.getUint32(off + 20, true)
    const usize  = view.getUint32(off + 24, true)
    const nlen   = view.getUint16(off + 28, true)
    const elen   = view.getUint16(off + 30, true)
    const clen   = view.getUint16(off + 32, true)
    const local  = view.getUint32(off + 42, true)
    const name   = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nlen))
    off += 46 + nlen + elen + clen

    // skip folders and the rubbish some zip tools add
    const base = name.split('/').pop()
    if (!base || name.endsWith('/') || base.startsWith('.') || name.startsWith('__MACOSX')) continue

    out.push({ name, base, method, csize, usize, local })
  }

  /* Each entry's data starts after its own local header, whose extra
     field length can differ from the one in the directory — a real
     source of off-by-a-few-bytes bugs if you trust the directory. */
  for (const e of out) {
    const nlen = view.getUint16(e.local + 26, true)
    const elen = view.getUint16(e.local + 28, true)
    const start = e.local + 30 + nlen + elen
    const raw = buf.subarray(start, start + e.csize)

    if (e.method === 0) {
      e.data = raw
    } else if (e.method === 8) {
      e.data = await inflate(raw)
    } else {
      e.error = `compressed in a way this cannot read (method ${e.method})`
    }
  }

  return out.filter(e => e.data || e.error)
}

async function inflate(raw) {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([raw]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/* ---------- what kind of file is this ---------- */

/* Matched on the file name, which is how the billing software names
   its exports. The content is checked too, because a file someone
   renamed is worse than one that is simply unrecognised. */

export function detectKind(name) {
  const n = name.toUpperCase().replace(/[_\-\s]+/g, ' ')
  if (/BILLWISE|BILL WISE/.test(n))                       return 'bill'
  if (/ITEMWISE|ITEM WISE|ITEMWISE SALES/.test(n))        return 'item'
  if (/SALESMANWISE|SALESMAN WISE|SALES MAN/.test(n))     return 'salesman'
  if (/STOCK\s*ANALYS|STOCK ANALYSIS|STOCKA/.test(n))     return 'stock'
  if (/STOCK MASTER|MASTER/.test(n))                      return 'stock'
  return null
}

export const KIND_LABEL = {
  bill: 'BILLWISE', item: 'ITEMWISE', salesman: 'SALESMANWISE', stock: 'Stock analysis'
}

/* ---------- which shop does it belong to ---------- */

/* The shop name is usually in the file name. Matched against the
   shop_map you already maintain, so there is one place that decides
   what a shop is called — not a second list living in here. */

export function detectShop(name, aliases) {
  const clean = name
    .replace(/\.(xlsx|xls)$/i, '')
    .replace(/\(\d+\)/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .toUpperCase()

  // longest alias first, so KADAKKAL wins over KADS
  const sorted = [...aliases].sort((a, b) => b.label.length - a.label.length)
  for (const a of sorted) {
    const label = a.label.toUpperCase()
    if (label.length < 3) continue
    if (clean.includes(label)) return a.shop_name
    // also try without spaces: GANDHISQUARE against GANDHI SQUARE
    if (clean.replace(/\s+/g, '').includes(label.replace(/\s+/g, ''))) return a.shop_name
  }
  return null
}

/* ---------- grouping ---------- */

/* Sales files only mean anything together — a BILLWISE without its
   ITEMWISE cannot be reconciled, and loading it alone would record a
   day with no item detail that looks complete. So they are grouped by
   shop and offered as a set. */

export function groupFiles(entries, aliases) {
  const groups = new Map()

  for (const e of entries) {
    const kind = detectKind(e.base)
    const shop = detectShop(e.base, aliases)
    const key = shop || 'unknown'
    if (!groups.has(key)) {
      groups.set(key, { shop, files: {}, extras: [], unknown: [] })
    }
    const g = groups.get(key)
    if (!kind) { g.unknown.push(e); continue }
    if (g.files[kind]) g.extras.push(e)   // a second file of the same kind
    else g.files[kind] = e
  }

  return [...groups.values()].map(g => ({
    ...g,
    hasSales: !!(g.files.bill && g.files.item),
    hasStock: !!g.files.stock,
    // a bill file with no item file cannot be reconciled
    salesIncomplete: !!g.files.bill !== !!g.files.item
  }))
}
