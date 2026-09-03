# How to upload — 35 files, one batch

You were re-uploading all 100 files. You only ever needed 35. That fits in
one GitHub drag-and-drop, which means one commit and one clean deploy.

Unzip `CHANGED-FILES-ONLY.zip`. Inside you get exactly this:

```
index.html
tailwind.config.js
vite.config.js
src/
  App.jsx
  index.css
  main.jsx
  lib/db.js
  lib/perms.js
  components/EntityBar.jsx
  pages/          (23 files)
supabase/
  19_permissions.sql
  20_role_defaults.sql
```

The folder names must stay exactly as they are. GitHub reads them to work
out where each file goes.

## Upload

1. Open your repository on github.com
2. **Add file → Upload files**
3. Drag in all four items together: the `src` folder, the `supabase`
   folder, and the three loose files at the top
4. Scroll down, type a message like `Rights, theme, dashboard`
5. **Commit changes**

Files already in the repo get replaced. Files not in this list are left
alone — nothing was deleted or renamed in any of these updates, so the
other 70 files in your repo are still correct.

## Then check the deploy actually happened

Vercel → your project → **Deployments**. Wait for the new entry to say
**Ready**.

If it says **Error**, open it and read the build log. The failing line is
named there. Send it to me.

If no new deployment appears at all, the commit did not land. Go back to
your repository, open `src/pages/Roles.jsx`, and see whether it exists. If
it does not, the upload failed.

## Then confirm the new code is live

Open the site, press F12, hard reload with Ctrl+Shift+R.

Look at the script filename in the console. **It must not be
`index-lPQZUmpH.js` any more.** That name is a fingerprint of the old code.
Until it changes, nothing has been fixed, and testing anything else is a
waste of time.

## Then run the SQL

Supabase → SQL Editor → New query.

1. Paste all of `supabase/19_permissions.sql`, press Run
2. New query, paste `supabase/20_role_defaults.sql`, press Run

Read the warning at the top of file 20 first. It overwrites role settings.

## While you are in the repo

Check whether `node_modules` or `dist` folders are sitting in it. If your
earlier drag-and-drop uploads included them, they are thousands of files and
they slow every build down. Delete them from GitHub if they are there —
they are build output and are meant to be rebuilt, never stored.
