"""
ATLAS INVENTORY SYNC
Reads godown stock, purchases and dispatches from the billing server
and pushes them to Supabase.

Runs alongside sync.py, which handles items and suppliers.

  python sync_inventory.py            normal run
  python sync_inventory.py --full     ignore watermarks, reload everything

Read-only against the billing database. Outbound connections only.
"""

import json, sys, time, datetime, urllib.request, urllib.error
import pyodbc

CONFIG_FILE = "config.json"
FULL = "--full" in sys.argv


def log(m):
    print(f"{datetime.datetime.now():%H:%M:%S}  {m}", flush=True)


def cfg():
    try:
        return json.load(open(CONFIG_FILE, encoding="utf-8"))
    except FileNotFoundError:
        sys.exit(f"{CONFIG_FILE} not found")
    except json.JSONDecodeError as e:
        sys.exit(f"{CONFIG_FILE} is not valid JSON: {e}")


# ----------------------------------------------------------------------
# billing database, read only
# ----------------------------------------------------------------------

def connect(c):
    b = c["billing"]
    parts = [f"DRIVER={{{b.get('driver','ODBC Driver 17 for SQL Server')}}}",
             f"SERVER={b['server']}", f"DATABASE={b['database']}"]
    if b.get("trusted_connection"):
        parts.append("Trusted_Connection=yes")
    else:
        parts += [f"UID={b['username']}", f"PWD={b['password']}"]
    return pyodbc.connect(";".join(parts), timeout=30, readonly=True)


def rows(conn, sql):
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


def clean_row(r):
    return {k: clean(v) for k, v in r.items()}


# ----------------------------------------------------------------------
# supabase
# ----------------------------------------------------------------------

def call(c, method, path, body=None, prefer=None):
    url = c["supabase"]["url"].rstrip("/") + "/rest/v1/" + path
    headers = {
        "apikey": c["supabase"]["service_key"],
        "Authorization": "Bearer " + c["supabase"]["service_key"],
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body, default=str).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

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


def push(c, table, data, conflict, label=None):
    """Insert or update, 500 at a time. Safe to re-run."""
    if not data:
        log(f"  {table}: nothing to send")
        return 0
    sent = 0
    for i in range(0, len(data), 500):
        chunk = data[i:i + 500]
        call(c, "POST", f"{table}?on_conflict={conflict}", chunk,
             "resolution=merge-duplicates,return=minimal")
        sent += len(chunk)
        if sent % 5000 == 0 or sent == len(data):
            log(f"  {label or table}: {sent}/{len(data)}")
    return sent


def get_branch_id(c):
    """Register this branch if new, then return its id."""
    code = c.get("branch_code", "GODOWN")
    body = [{
        "code": code,
        "name": c.get("branch_name", "Godown"),
        "db_name": c["billing"]["database"],
        "location_code": c.get("location_code", "001"),
        "is_master": bool(c.get("is_master", True)),
        "active": True,
        "last_seen_at": datetime.datetime.now().isoformat(),
    }]
    call(c, "POST", "branches?on_conflict=code", body,
         "resolution=merge-duplicates,return=minimal")
    got = call(c, "GET", f"branches?code=eq.{code}&select=id")
    if not got:
        raise RuntimeError("Could not register the branch")
    return got[0]["id"]


def watermark(c, branch_id, stream):
    if FULL:
        return None
    got = call(c, "GET",
               f"sync_state?branch_id=eq.{branch_id}&stream=eq.{stream}&select=watermark_date")
    return got[0]["watermark_date"] if got and got[0].get("watermark_date") else None


def save_state(c, branch_id, stream, wm, n, status, msg=""):
    call(c, "POST", "sync_state?on_conflict=branch_id,stream", [{
        "branch_id": branch_id, "stream": stream,
        "watermark_date": wm,
        "last_run_at": datetime.datetime.now().isoformat(),
        "last_ok_at": datetime.datetime.now().isoformat() if status == "ok" else None,
        "rows_last_run": n, "status": status, "message": msg[:2000] or None,
    }], "resolution=merge-duplicates,return=minimal")


# ----------------------------------------------------------------------
# the three streams
# ----------------------------------------------------------------------

# avlQty is stock actually on hand. The plain qty column carries
# movements and goes negative, which is why it totalled wrongly.
# ACTUALCOST holds landed cost but is blank on 98% of items, so cost is
# computed as purchase rate plus GST, which is how you define it.
STOCK_SQL = """
select
  ltrim(rtrim(s.itemcode)) as item_code, ltrim(rtrim(s.itemname)) as item_name,
  ltrim(rtrim(isnull(s.DIVISION,''))) as division,
  ltrim(rtrim(isnull(s.groupcode,''))) as category,
  ltrim(rtrim(isnull(s.subgroup,''))) as sub_category,
  ltrim(rtrim(isnull(s.brand,''))) as brand,
  s.HSNCODE as hsn, s.IGST as tax_rate,
  s.suppcode as supplier_code, a.HEAD as supplier_name,
  s.avlQty          as qty,
  s.Purchprice      as purchase_rate,
  case when isnull(s.ACTUALCOST,0) > 0 then s.ACTUALCOST
       else round(isnull(s.Purchprice,0) * (1 + isnull(s.IGST,0)/100.0), 2)
  end               as cost_rate,
  s.RPrice          as selling_rate,
  p.first_purchase, p.last_purchase
from dbo.STOCKMST001 s
left join dbo.ACCOUNTS001 a on a.CODE = s.suppcode
left join (
  select i.ITEMCODE, min(h.[DATE]) as first_purchase, max(h.[DATE]) as last_purchase
    from dbo.PITEM001 i join dbo.PURCHASE001 h on h.ORDERNO = i.ORDERNO
   group by i.ITEMCODE
) p on p.ITEMCODE = s.itemcode
where s.avlQty > 0
  and s.itemname is not null and ltrim(rtrim(s.itemname)) <> ''
"""

PURCHASE_SQL = """
select
  h.ORDERNO as purch_no, i.RECNO as line_no, cast(h.[DATE] as date) as purch_date,
  h.INVNO as bill_no, cast(h.INVDATE as date) as bill_date,
  h.SUPPCODE as supplier_code, h.SUPPNAME as supplier_name,
  ltrim(rtrim(i.ITEMCODE)) as item_code, ltrim(rtrim(i.ITEMNAME)) as item_name,
  ltrim(rtrim(isnull(i.GROUPCODE,''))) as category,
  ltrim(rtrim(isnull(i.SUBGROUP,''))) as sub_category,
  ltrim(rtrim(isnull(i.BRAND,''))) as brand,
  ltrim(rtrim(isnull(i.COMPANY,''))) as division,
  i.HSNCODE as hsn, i.QTY as qty, i.FOC as free_qty,
  i.PRICE as purchase_rate, i.LC as cost_rate, i.SPRICE as selling_rate,
  i.DISCAMT as discount, i.TAXPER as tax_rate, i.TAXAMT as tax_amount,
  i.NETAMT as line_value
from dbo.PITEM001 i
join dbo.PURCHASE001 h on h.ORDERNO = i.ORDERNO
where h.[DATE] >= '{since}'
"""

DISPATCH_SQL = """
select
  cast(h.ORDERNO as varchar(30)) as doc_no, i.SLNO as line_no,
  cast(h.DATE1 as date) as doc_date,
  '001' as from_location,
  isnull(nullif(ltrim(rtrim(h.SITE)),''), h.CUSTCODE) as to_location,
  ltrim(rtrim(i.ITEMCODE)) as item_code, ltrim(rtrim(i.ITEMNAME)) as item_name,
  i.QTY as qty, i.RATE as rate
from dbo.transoutitem001 i
join dbo.transout001 h on h.ORDERNO = i.ORDERNO
where h.DATE1 >= '{since}'
"""


def sync_stock(conn, c, branch_id):
    log("Godown stock")
    src = rows(conn, STOCK_SQL)
    log(f"  {len(src)} rows read")
    out = []
    for r in src:
        d = clean_row(r)
        d["branch_id"] = branch_id
        d["location_code"] = c.get("location_code", "001")
        d["synced_at"] = datetime.datetime.now().isoformat()
        if d.get("item_code"):
            out.append(d)
    n = push(c, "godown_stock", out, "branch_id,location_code,item_code", "stock")
    save_state(c, branch_id, "godown_stock", None, n, "ok")
    return n


def sync_purchases(conn, c, branch_id):
    since = watermark(c, branch_id, "godown_purchases")
    if not since:
        since = (datetime.date.today() - datetime.timedelta(days=730)).isoformat()
        log(f"Purchases — first load from {since}")
    else:
        log(f"Purchases since {since}")

    src = rows(conn, PURCHASE_SQL.format(since=since))
    log(f"  {len(src)} rows read")

    out, newest = [], since
    for r in src:
        d = clean_row(r)
        d["branch_id"] = branch_id
        d["synced_at"] = datetime.datetime.now().isoformat()
        if d.get("purch_no") and d.get("item_code"):
            d["purch_no"] = str(d["purch_no"])
            out.append(d)
            if d.get("purch_date") and d["purch_date"] > newest:
                newest = d["purch_date"]

    n = push(c, "godown_purchases", out, "branch_id,purch_no,line_no", "purchases")
    save_state(c, branch_id, "godown_purchases", newest, n, "ok")
    return n


def sync_dispatches(conn, c, branch_id):
    since = watermark(c, branch_id, "dispatches")
    if not since:
        since = (datetime.date.today() - datetime.timedelta(days=180)).isoformat()
        log(f"Dispatches — first load from {since}")
    else:
        log(f"Dispatches since {since}")

    src = rows(conn, DISPATCH_SQL.format(since=since))
    log(f"  {len(src)} rows read")

    out, newest = [], since
    for r in src:
        d = clean_row(r)
        if not d.get("doc_no") or not d.get("item_code"):
            continue
        out.append({
            "branch_id": branch_id, "direction": "out",
            "doc_no": str(d["doc_no"]), "line_no": int(d.get("line_no") or 1),
            "doc_date": d["doc_date"],
            "from_location": d.get("from_location"), "to_location": d.get("to_location"),
            "item_code": d["item_code"], "item_name": d.get("item_name"),
            "qty": d.get("qty") or 0, "rate": d.get("rate"),
            "synced_at": datetime.datetime.now().isoformat(),
        })
        if d.get("doc_date") and d["doc_date"] > newest:
            newest = d["doc_date"]

    n = push(c, "stock_movements", out, "branch_id,direction,doc_no,line_no", "dispatches")
    save_state(c, branch_id, "dispatches", newest, n, "ok")
    return n


# ----------------------------------------------------------------------

def main():
    c = cfg()
    log("=" * 55)
    log("Inventory sync starting" + (" (full reload)" if FULL else ""))

    conn = None
    branch_id = None
    try:
        branch_id = get_branch_id(c)
        log(f"Branch {c.get('branch_code','GODOWN')} registered")

        conn = connect(c)
        log(f"Connected to {c['billing']['database']} (read only)")

        a = sync_stock(conn, c, branch_id)
        b = sync_purchases(conn, c, branch_id)
        d = sync_dispatches(conn, c, branch_id)

        log(f"Done. {a} stock, {b} purchase lines, {d} dispatch lines.")
    except pyodbc.Error as e:
        log(f"BILLING DATABASE ERROR: {e}")
        sys.exit(1)
    except Exception as e:
        log(f"FAILED: {e}")
        if branch_id:
            try:
                save_state(c, branch_id, "inventory", None, 0, "failed", str(e))
            except Exception:
                pass
        sys.exit(1)
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
