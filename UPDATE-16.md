# Update 16 — The blank white page

## What was happening

`src/lib/db.js` called `createClient(url, key)` at the top of the file. When
either value is missing, that call **throws immediately** — before React
starts, before anything is drawn. The browser is left with an empty `<div>`
and shows a white page with no message at all.

The two values come from environment variables:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

They are missing whenever:

- `.env` does not exist on your laptop (it is gitignored, so it never
  travels with the code — a fresh unzip never has one), or
- Vercel has no Environment Variables set for the project, or
- you added them on Vercel but did not redeploy. **Vite bakes these into
  the JavaScript at build time.** An existing deployment cannot pick them
  up; it has to be built again.

## Check it in ten seconds

Open the white page, press **F12**, and look at the Console tab. If it says:

```
Error: supabaseUrl is required.
```

that is this problem, and the fix below is all you need.

If it says something else, the app now prints that error on the screen
instead of going white — reload after deploying this update and read it.

## Fix

**Vercel:** Settings → Environment Variables → add both → then
Deployments → ⋯ → **Redeploy**. The redeploy is the part people skip.

**Laptop:**

```bash
cp .env.example .env
# open .env and paste your two values
npm run dev
```

Both values are in Supabase under Project Settings → API. The anon key is
designed to be public and is safe in the browser — RLS is what protects
your data, not that key.

## What changed so this cannot go silent again

**`src/lib/db.js`** no longer throws. It checks the two settings and
exports a `configured` flag.

**`src/main.jsx`** now has two guards:

1. If the settings are missing, it draws a page that says so and gives the
   exact steps for Vercel and for a laptop.
2. If anything else throws while drawing a page, an error boundary catches
   it and prints the error on screen with a button back to the dashboard.

A white page with no explanation should not be possible from here.

## Worth knowing

I ran the app headlessly against a mocked database as executive, manager,
HOD, accounts and admin, on the dashboard, Users and Roles pages. No render
errors on any of them. The code from updates 13 to 15 is not the cause of
this — it is the missing settings, and it would have done the same thing
before those updates.
