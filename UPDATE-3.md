# Update 3 — entity switcher and purchase type placement

No SQL this time. Only code files.

## What to change in GitHub

**New file** — Add file → Create new file → name it exactly:
```
src/components/EntityBar.jsx
```

**Edit these four** — open each, pencil icon, select all, paste the new version, Commit:

| File | What changed |
|---|---|
| `src/App.jsx` | remembers which entity you are viewing |
| `src/pages/Dashboard.jsx` | entity switcher at the top, all figures follow it |
| `src/pages/POList.jsx` | entity switcher, order list follows it |
| `src/pages/NewPO.jsx` | purchase type appears after the supplier is chosen |

Vercel rebuilds itself. Hard-refresh with Ctrl + Shift + R after 2 minutes.

## What you'll see

**Dashboard and Orders now have a row of buttons at the top:**

```
[ Mixed ]  [ E1 ]  [ E2 ]  [ E3 ]
```

Pick E1 and everything on the page — pending approvals, month value, recent
orders, the order list — shows E1 only. Pick Mixed and you get all three
together, with the entity-split bar chart showing the breakdown.

Your choice is remembered, so if you always work in E2 it stays on E2 next time
you open the app.

**Staff locked to one entity never see the buttons.** They just see their entity
name as plain text. There is nothing for them to switch to.

**On the new order screen**, the purchase type buttons now stay hidden until a
supplier is picked, so the form fills in the order it's actually thought about:
entity → supplier → type → delivery date → remarks.

## Test it

1. As admin, tap E1 → month value changes, only E1 orders listed
2. Tap Mixed → totals go up, entity bar chart appears
3. Refresh the page → it remembers the last entity you picked
4. Sign in as an entity-locked executive → no buttons, just the entity name
5. New order → type buttons appear only after you choose the supplier
