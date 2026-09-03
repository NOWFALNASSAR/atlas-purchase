"""
ATLAS LIVE SYNC  —  DBSERVER-ATLAS  ->  Supabase

Reads the live billing database and pushes godown stock and purchase
detail to Supabase. Built from your own report query, so the tables and
columns match what the billing software actually uses:

  Stock       one row per barcode, with Opening/Purchase/Sales/Balance
  PurchMain   the barcode's purchase line — rates, brand, subclasses
  PurchTemp1  the purchase invoice — InvNo, ArrDate, Amount
  Item        item master (name, division, tax) — in the masters database
  DiviMast    division names
  Brand, Supplier, Place, Tax

Read-only. Outbound connections only.

  python sync_atlas.py            normal run
  python sync_atlas.py --full     reload everything
  python sync_atlas.py --test     read a few rows and print them, push nothing
"""

import json, sys, time, datetime, urllib.request, urllib.error
import pyodbc

CONFIG = "config.json"
FULL = "--full" in sys.argv
TEST = "--test" in sys.argv


def log(m):
    print(f"{datetime.datetime.now():%H:%M:%S}  {m}", flush=True)


def cfg():
    try:
        return json.load(open(CONFIG, encoding="utf-8"))
    except FileNotFoundError:
        sys.exit(f"{CONFIG} not found")
    except json.JSONDecodeError as e:
        sys.exit(f"{CONFIG} is not valid JSON: {e}")


# ----------------------------------------------------------------------
# billing server
# ----------------------------------------------------------------------

def connect(c):
    b = c["billing"]
    parts = [f"DRIVER={{{b.get('driver','ODBC Driver 17 for SQL Server')}}}",
             f"SERVER={b['server']}", f"DATABASE={b['database']}"]
    if b.get("trusted_connection"):
        parts.append("Trusted_Connection=yes")
    else:
        parts += [f"UID={b['username']}", f"PWD={b['password']}"]
    return pyodbc.connect(";".join(parts), timeout=60, readonly=True)


def query(conn, sql):
    cur = conn.cursor()
    cur.execute(sql)
    cols = [d[0] for d in cur.description]
    out = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()
    return out


def clean(v):
    from decimal import Decimal
    if v is None:
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()[:10]
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", "ignore").strip() or None
    if isinstance(v, str):
        return v.strip() or None
    return v


def row(r):
    return {k: clean(v) for k, v in r.items()}


# ----------------------------------------------------------------------
# supabase
# ----------------------------------------------------------------------

def call(c, method, path, body=None, prefer=None):
    url = c["supabase"]["url"].rstrip("/") + "/rest/v1/" + path
    h = {"apikey": c["supabase"]["service_key"],
         "Authorization": "Bearer " + c["supabase"]["service_key"],
         "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    data = json.dumps(body, default=str).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")[:400]
            if attempt == 2:
                raise RuntimeError(f"{path}: HTTP {e.code} — {detail}")
            log(f"  retry {attempt+1}: {e.code}")
            time.sleep(5)
        except urllib.error.URLError as e:
            if attempt == 2:
                raise RuntimeError(f"{path}: no connection — {e.reason}")
            log("  no connection, waiting 30s")
            time.sleep(30)


def push(c, table, rows, conflict, label=None):
    if not rows:
        log(f"  {label or table}: nothing to send")
        return 0
    sent = 0
    for i in range(0, len(rows), 500):
        call(c, "POST", f"{table}?on_conflict={conflict}", rows[i:i + 500],
             "resolution=merge-duplicates,return=minimal")
        sent += len(rows[i:i + 500])
        if sent % 5000 == 0 or sent == len(rows):
            log(f"  {label or table}: {sent}/{len(rows)}")
    return sent


def branch_id(c):
    code = c.get("branch_code", "GODOWN")
    call(c, "POST", "branches?on_conflict=code", [{
        "code": code, "name": c.get("branch_name", "Godown"),
        "db_name": c["billing"]["database"],
        "location_code": c.get("location_code", "001"),
        "is_master": True, "active": True,
        "last_seen_at": datetime.datetime.now().isoformat()}],
        "resolution=merge-duplicates,return=minimal")
    got = call(c, "GET", f"branches?code=eq.{code}&select=id")
    if not got:
        raise RuntimeError("could not register branch")
    return got[0]["id"]


def save_state(c, bid, stream, wm, n, status, msg=""):
    call(c, "POST", "sync_state?on_conflict=branch_id,stream", [{
        "branch_id": bid, "stream": stream, "watermark_date": wm,
        "last_run_at": datetime.datetime.now().isoformat(),
        "last_ok_at": datetime.datetime.now().isoformat() if status == "ok" else None,
        "rows_last_run": n, "status": status, "message": msg[:2000] or None}],
        "resolution=merge-duplicates,return=minimal")


# ----------------------------------------------------------------------
# the queries — built from your own report query
# ----------------------------------------------------------------------

def stock_sql(c):
    m = c["masters_db"]
    return f"""
select
  s.BarCode                       as barcode,
  s.LotCode                       as lot_code,
  s.ItemCode                      as item_code,
  i.ItemName                      as item_name,
  d.DiviName                      as division,
  b.BrandName                     as brand,
  p.SubClass1Code                 as class1,
  p.SubClass2Code                 as class2,
  p.SubClass3Code                 as class3,
  t.Tax                           as tax_rate,
  s.Supcode                       as supplier_code,
  sup.SupName                     as supplier_name,
  pl.Place                        as supplier_place,
  s.Opening                       as opening,
  s.Purchase                      as purchase,
  s.Sales                         as sales,
  s.Adjust                        as adjust,
  s.SalesRetn                     as sales_return,
  s.PurcRetn                      as purchase_return,
  s.Balance                       as balance,
  p.PurRate                       as purchase_rate,
  round(p.NetAmt / nullif(p.PurQty,0), 3)                          as cost_rate,
  round((p.NetAmt + p.DiscAmt) / nullif(p.PurQty,0), 3)            as cost_rate2,
  p.SelRate                       as selling_rate,
  p.VATPer                        as vat_per,
  pt.InvNo                        as invoice_no,
  cast(pt.InvDated as date)       as invoice_date,
  cast(pt.ArrDate  as date)       as arrival_date
from dbo.Stock s
join dbo.PurchMain  p  on p.LotCode  = s.LotCode
left join dbo.PurchTemp1 pt on pt.PurRefNo = p.PurRefNo and pt.PurRefSt = p.PurRefSt
left join {m}.dbo.Item      i   on i.ItemCode   = s.ItemCode
left join {m}.dbo.DiviMast  d   on d.DiviCode   = i.DiviCode
left join {m}.dbo.Brand     b   on b.BrandCode  = p.BrandCode
left join {m}.dbo.Supplier  sup on sup.SupCode  = s.Supcode
left join {m}.dbo.Place     pl  on pl.PlaceCode = sup.PlaceCode
left join {m}.dbo.Tax       t   on t.TaxCode    = i.TaxCode
where s.Balance <> 0
  and s.BarCode not like 'XX%'
"""


def purchase_sql(c, since):
    m = c["masters_db"]
    return f"""
select
  p.PurRefNo                      as purch_no,
  p.LotCode                       as lot_code,
  s.BarCode                       as barcode,
  cast(pt.ArrDate as date)        as purch_date,
  pt.InvNo                        as bill_no,
  cast(pt.InvDated as date)       as bill_date,
  s.Supcode                       as supplier_code,
  sup.SupName                     as supplier_name,
  s.ItemCode                      as item_code,
  i.ItemName                      as item_name,
  d.DiviName                      as division,
  b.BrandName                     as brand,
  p.PurQty                        as qty,
  p.PurRate                       as purchase_rate,
  round(p.NetAmt / nullif(p.PurQty,0), 3) as cost_rate,
  p.SelRate                       as selling_rate,
  p.DiscAmt                       as discount,
  p.NetAmt                        as line_value,
  t.Tax                           as tax_rate
from dbo.PurchMain p
join dbo.Stock s on s.LotCode = p.LotCode
left join dbo.PurchTemp1 pt on pt.PurRefNo = p.PurRefNo and pt.PurRefSt = p.PurRefSt
left join {m}.dbo.Item     i   on i.ItemCode  = s.ItemCode
left join {m}.dbo.DiviMast d   on d.DiviCode  = i.DiviCode
left join {m}.dbo.Brand    b   on b.BrandCode = p.BrandCode
left join {m}.dbo.Supplier sup on sup.SupCode = s.Supcode
left join {m}.dbo.Tax      t   on t.TaxCode   = i.TaxCode
where pt.ArrDate >= '{since}'
  and s.BarCode not like 'XX%'
"""


# ----------------------------------------------------------------------

def sync_stock(conn, c, bid):
    log("Godown stock")
    src = query(conn, stock_sql(c))
    log(f"  {len(src)} barcodes read")

    out = []
    for r in src:
        d = row(r)
        if not d.get("barcode"):
            continue
        out.append({
            "branch_id": bid,
            "location_code": c.get("location_code", "001"),
            "item_code": str(d["barcode"]),
            "item_name": d.get("item_name"),
            "division": d.get("division"),
            "category": d.get("class1"),
            "sub_category": d.get("class2"),
            "brand": d.get("brand"),
            "colour": d.get("class3"),
            "tax_rate": d.get("tax_rate"),
            "supplier_code": str(d.get("supplier_code") or "") or None,
            "supplier_name": d.get("supplier_name"),
            "qty": d.get("balance") or 0,
            "purchase_rate": d.get("purchase_rate"),
            "cost_rate": d.get("cost_rate"),
            "selling_rate": d.get("selling_rate"),
            "first_purchase": d.get("arrival_date"),
            "last_purchase": d.get("arrival_date"),
            "synced_at": datetime.datetime.now().isoformat(),
        })

    pieces = sum(float(r["qty"] or 0) for r in out)
    cost = sum(float(r["qty"] or 0) * float(r["cost_rate"] or 0) for r in out)
    sell = sum(float(r["qty"] or 0) * float(r["selling_rate"] or 0) for r in out)
    log(f"  balance {pieces:,.0f} pcs   cost {cost/10000000:.2f} Cr   selling {sell/10000000:.2f} Cr")

    if TEST:
        log("  test mode — not pushing")
        for r in out[:3]:
            log(f"    {r['item_code']} {r['item_name']} qty={r['qty']} "
                f"cost={r['cost_rate']} sell={r['selling_rate']}")
        return 0

    n = push(c, "godown_stock", out, "branch_id,location_code,item_code", "stock")
    save_state(c, bid, "godown_stock", None, n, "ok")
    return n


def sync_purchases(conn, c, bid):
    since = None
    if not FULL:
        got = call(c, "GET",
                   f"sync_state?branch_id=eq.{bid}&stream=eq.godown_purchases&select=watermark_date")
        since = got[0]["watermark_date"] if got and got[0].get("watermark_date") else None
    if not since:
        since = c.get("purchases_from", "2026-04-01")
        log(f"Purchases — first load from {since}")
    else:
        log(f"Purchases since {since}")

    src = query(conn, purchase_sql(c, since))
    log(f"  {len(src)} lines read")

    out, newest = [], since
    for r in src:
        d = row(r)
        if not d.get("purch_no") or not d.get("barcode"):
            continue
        out.append({
            "branch_id": bid,
            "purch_no": str(d["purch_no"]),
            "line_no": int(d.get("lot_code") or 1),
            "purch_date": d.get("purch_date"),
            "bill_no": d.get("bill_no"),
            "bill_date": d.get("bill_date"),
            "supplier_code": str(d.get("supplier_code") or "") or None,
            "supplier_name": d.get("supplier_name"),
            "item_code": str(d["barcode"]),
            "item_name": d.get("item_name"),
            "division": d.get("division"),
            "brand": d.get("brand"),
            "qty": d.get("qty") or 0,
            "purchase_rate": d.get("purchase_rate"),
            "cost_rate": d.get("cost_rate"),
            "selling_rate": d.get("selling_rate"),
            "discount": d.get("discount") or 0,
            "tax_rate": d.get("tax_rate"),
            "line_value": d.get("line_value") or 0,
            "synced_at": datetime.datetime.now().isoformat(),
        })
        if d.get("purch_date") and d["purch_date"] > newest:
            newest = d["purch_date"]

    if TEST:
        log("  test mode — not pushing")
        return 0

    n = push(c, "godown_purchases", out, "branch_id,purch_no,line_no", "purchases")
    save_state(c, bid, "godown_purchases", newest, n, "ok")
    return n


def main():
    c = cfg()
    log("=" * 55)
    log("Atlas live sync" + (" (full)" if FULL else "") + (" (test)" if TEST else ""))

    conn = None
    bid = None
    try:
        bid = None if TEST else branch_id(c)
        conn = connect(c)
        log(f"Connected to {c['billing']['server']} / {c['billing']['database']} (read only)")

        a = sync_stock(conn, c, bid)
        b = sync_purchases(conn, c, bid)
        log(f"Done. {a} stock rows, {b} purchase lines.")
    except pyodbc.Error as e:
        log(f"BILLING DATABASE ERROR: {e}")
        sys.exit(1)
    except Exception as e:
        log(f"FAILED: {e}")
        if bid:
            try:
                save_state(c, bid, "atlas", None, 0, "failed", str(e))
            except Exception:
                pass
        sys.exit(1)
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
