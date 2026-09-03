# Update 17 — The toFixed crash

## What the error meant

```
TypeError: Cannot read properties of undefined (reading 'toFixed')
```

Something tried to format a number that was not there. `.toFixed()` on
`undefined` throws, React unmounts the entire tree, and the page goes blank.
One missing figure takes down the whole screen.

It happens when a database view returns `null` where a number was expected —
a branch with no target set, a sync that has not run, a month with no
comparison data.

## What I changed

**Every figure now goes through a formatter that cannot throw.** New helper
in `src/lib/db.js`:

```js
num(v, decimals = 0, fallback = null)
```

`num(undefined)` gives `'0'` instead of throwing. Eleven call sites across
Dashboard, SalesDashboard, SalesBranches, Reports and Inventory were moved
onto it.

I then ran every route in the app headlessly, as admin, against a database
that returns `null` for every numeric column. No crashes on any of them.

**Source maps are now on** (`vite.config.js`). Before this, a crash reported
a position inside a minified file:

```
index-lPQZUmpH.js:95:74048
```

which names nothing you can act on. Now the console and the app's own error
screen name the real file and line, like `Dashboard.jsx:416`.

Source maps add `.map` files to the build. Browsers download them only when
DevTools is open, so staff never pay for them, and they expose nothing — the
source is already in the browser either way.

## If a page still crashes

You will no longer get a blank white page. The error boundary added in
update 16 prints the error on screen with a button back to the dashboard.

With source maps on, that message now names a real file and line. Send me
that line and it is a two-minute fix.

## Honest note

I could not reproduce your exact crash here. Every `.toFixed()` in the
source I have was already guarded, which means either your deployed build is
older than the code I last sent you, or your live data has a shape my test
data did not.

Either way this update removes the entire class of failure rather than one
instance of it, and if anything similar happens again the app will now tell
you exactly where instead of going blank.

## Deploy

```bash
npm install
npm run build   # check it succeeds locally first
```

Then push and let Vercel redeploy. Confirm your two environment variables
are still set — that was the first thing we checked, and it stays true.
