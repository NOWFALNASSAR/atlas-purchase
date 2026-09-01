"""
ATLAS BILLING SYNC
Reads the billing SQL Server database and pushes masters into Supabase.

Two rules this program follows, and you should never relax:
  1. It opens the billing database READ ONLY. It has no code that writes,
     updates or deletes anything there.
  2. It only makes outbound connections. Nothing needs to be opened on
     your firewall, and the billing server is never exposed to the internet.

Setup and scheduling: see BILLING-SYNC.md
"""

import json, sys, time, datetime, urllib.request, urllib.error
import pyodbc

CONFIG_FILE = "config.json"


# ----------------------------------------------------------------------
# config
# ----------------------------------------------------------------------

def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit(f"{CONFIG_FILE} not found. Copy config.example.json and fill it in.")
    except json.JSONDecodeError as e:
        sys.exit(f"{CONFIG_FILE} is not valid JSON: {e}")


def log(msg):
    print(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}", flush=True)


# ----------------------------------------------------------------------
# billing database (read only)
# ----------------------------------------------------------------------

def connect_billing(cfg):
    c = cfg["billing"]
    parts = [
        f"DRIVER={{{c.get('driver', 'ODBC Driver 17 for SQL Server')}}}",
        f"SERVER={c['server']}",
        f"DATABASE={c['database']}",
        "ApplicationIntent=ReadOnly",
    ]
    if c.get("trusted_connection"):
        parts.append("Trusted_Connection=yes")
    else:
        parts += [f"UID={c['username']}", f"PWD={c['password']}"]
    return pyodbc.connect(";".join(parts), timeout=30, readonly=True)


def fetch(conn, sql):
    cur = conn.cursor()
    cur.execute(sql)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()
    return rows


def clean(v):
    """SQL Server types that JSON cannot carry."""
    if v is None:
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    if isinstance(v, bytes):
        return v.decode("utf-8", "ignore").strip()
    if isinstance(v, str):
        return v.strip() or None
    from decimal import Decimal
    if isinstance(v, Decimal):
        return float(v)
    return v


def digits(v, n=10):
    if not v:
        return None
    d = "".join(ch for ch in str(v) if ch.isdigit())
    return d[-n:] if d else None


# ----------------------------------------------------------------------
# supabase (outbound https only)
# ----------------------------------------------------------------------

def push(cfg, table, rows, on_conflict):
    """Insert or update rows in Supabase, 500 at a time."""
    if not rows:
        return 0

    url = f"{cfg['supabase']['url']}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {
        "apikey": cfg["supabase"]["service_key"],
        "Authorization": "Bearer " + cfg["supabase"]["service_key"],
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    sent = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        body = json.dumps(chunk, default=str).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    r.read()
                sent += len(chunk)
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "ignore")[:400]
                if attempt == 2:
                    raise RuntimeError(f"{table}: HTTP {e.code} — {detail}")
                log(f"  retry {attempt + 1} on {table}: {e.code}")
                time.sleep(5)
            except urllib.error.URLError as e:
                if attempt == 2:
                    raise RuntimeError(f"{table}: no connection — {e.reason}")
                log(f"  no connection, retrying in 30s")
                time.sleep(30)

        log(f"  {table}: {sent}/{len(rows)}")
    return sent


def write_log(cfg, source, read, pushed, status, message=""):
    try:
        push(cfg, "sync_log", [{
            "source": source, "rows_read": read, "rows_pushed": pushed,
            "status": status, "message": message[:2000],
            "ran_at": datetime.datetime.now().isoformat()
        }], "id")
    except Exception as e:
        log(f"  (could not write sync log: {e})")


# ----------------------------------------------------------------------
# the two syncs
# ----------------------------------------------------------------------

def sync_items(conn, cfg):
    m = cfg["items"]
    log("Reading items from billing")
    raw = fetch(conn, m["query"])
    log(f"  {len(raw)} rows read")

    seen, out = set(), []
    for r in raw:
        code = clean(r.get(m["code"]))
        name = clean(r.get(m["name"]))
        if not code or not name:
            continue
        if code in seen:
            continue
        seen.add(code)

        out.append({
            "code": str(code),
            "name": name,
            "external_id": str(code),
            "category": clean(r.get(m.get("division"))) or None,
            "division": clean(r.get(m.get("division"))) or None,
            "hsn": clean(r.get(m.get("hsn"))) or None,
            "unit": clean(r.get(m.get("unit"))) or "Nos",
            "tax_rate": clean(r.get(m.get("tax"))),
            "std_selling": clean(r.get(m.get("selling"))),
            "active": True,
            "synced_at": datetime.datetime.now().isoformat(),
        })

    log(f"  {len(out)} items to push")
    n = push(cfg, "items", out, "code")
    write_log(cfg, "items", len(raw), n, "ok")
    return n


def sync_suppliers(conn, cfg):
    m = cfg["suppliers"]
    log("Reading suppliers from billing")
    raw = fetch(conn, m["query"])
    log(f"  {len(raw)} rows read")

    seen, out = set(), []
    for r in raw:
        code = clean(r.get(m["code"]))
        name = clean(r.get(m["name"]))
        if not code or not name:
            continue
        if code in seen:
            continue
        seen.add(code)

        phone = digits(clean(r.get(m.get("phone"))))
        out.append({
            "code": str(code),
            "name": name,
            "external_id": str(code),
            "address": clean(r.get(m.get("address"))),
            "address2": clean(r.get(m.get("address2"))),
            "place": clean(r.get(m.get("place"))),
            "gstin": clean(r.get(m.get("gstin"))),
            "mobile": phone,
            "whatsapp": digits(clean(r.get(m.get("whatsapp")))) or phone,
            "email": clean(r.get(m.get("email"))),
            "active": True,
            "synced_at": datetime.datetime.now().isoformat(),
        })

    log(f"  {len(out)} suppliers to push")
    n = push(cfg, "suppliers", out, "code")
    write_log(cfg, "suppliers", len(raw), n, "ok")
    return n


# ----------------------------------------------------------------------

def main():
    cfg = load_config()
    log("=" * 60)
    log("Atlas billing sync starting")

    conn = None
    try:
        conn = connect_billing(cfg)
        log(f"Connected to {cfg['billing']['database']} (read only)")

        items = sync_items(conn, cfg)
        sups = sync_suppliers(conn, cfg)

        log(f"Done. {items} items, {sups} suppliers.")
    except pyodbc.Error as e:
        log(f"BILLING DATABASE ERROR: {e}")
        write_log(cfg, "sync", 0, 0, "failed", str(e))
        sys.exit(1)
    except Exception as e:
        log(f"FAILED: {e}")
        write_log(cfg, "sync", 0, 0, "failed", str(e))
        sys.exit(1)
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
