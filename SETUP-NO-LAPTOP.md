# Go live without a laptop
**Everything in a browser. No software to install. About 2 hours.**

You need three free accounts and the `atlas-purchase.zip` file.
Works on a tablet, a phone, or any computer's browser — nothing gets installed anywhere.

> **Before you start:** if you are on a phone, open Chrome, tap the ⋮ menu and tick
> **Desktop site**. GitHub and Supabase are much easier that way. A tablet or any
> desktop browser is easier still.

---

# PART A — Supabase (the database) · 30 minutes

### A1. Create the account
1. Go to **supabase.com** → **Start your project**
2. Sign in with GitHub (create the GitHub account now if you don't have one — you need it in Part B anyway)

### A2. Create the project
3. Click **New project**
4. Name: `atlas-purchase`
5. Database password: type a strong one and **save it in your notes app**
6. Region: **South Asia (Mumbai)**
7. Click **Create new project**, wait 2 minutes

### A3. Run the three scripts
8. Left menu → **SQL Editor** → **New query**
9. Open `supabase/01_schema.sql` from the zip, copy **everything**, paste it in, click **Run**
   - You should see *Success. No rows returned.*
10. Click **New query** again → paste all of `02_rls.sql` → **Run**
11. Before the third one, open `03_seed.sql` and **change the shop names to your real 24 shops**
    (edit it in any notes app, then copy). Then **New query** → paste → **Run**

### A4. Create the photo folder
12. Left menu → **Storage** → **New bucket**
13. Name: `po-photos`
14. **Public bucket: leave it OFF**
15. Click **Create bucket**

### A5. Turn off email confirmation
16. Left menu → **Authentication** → **Sign In / Providers** → **Email**
17. Switch **Confirm email** OFF → Save
    *(otherwise every staff member has to click a confirmation email before they can log in)*

### A6. Copy your two keys
18. Left menu → **Project Settings** (gear) → **API Keys**
19. Copy these two into your notes app — you need them in Part C:
    - **Project URL** — looks like `https://abcdefgh.supabase.co`
    - **anon public key** — a very long text starting `eyJ...`

✅ **Part A done.** Your database is live.

---

# PART B — GitHub (where the code lives) · 30 minutes

### B1. Unzip the code on your device
- **iPhone/iPad:** open Files app → tap `atlas-purchase.zip` → it unzips into a folder
- **Android:** Files app → tap the zip → **Extract**
- **Any computer:** double-click the zip

### B2. Create the repository
1. Go to **github.com** → sign in
2. Top right **+** → **New repository**
3. Repository name: `atlas-purchase`
4. Choose **Private**
5. Click **Create repository**

### B3. Upload the files

**Method 1 — drag and drop (easiest, works on any desktop browser or tablet)**

6. On the new empty repo page, click **uploading an existing file**
7. Open the unzipped `atlas-purchase` folder
8. Select **all** files and folders inside it and drag them onto the GitHub page
   — GitHub keeps the folder structure automatically
9. Scroll down → **Commit changes**

**Method 2 — if drag and drop won't work on your device**

GitHub creates folders automatically when you type a slash in the filename. So:

6. Click **creating a new file**
7. In the filename box type: `package.json`
8. Paste the contents of that file below
9. Scroll down → **Commit changes**
10. Then **Add file → Create new file** and repeat for each file, typing the full
    path in the name box:

```
package.json
vite.config.js
postcss.config.js
tailwind.config.js
index.html
README.md
src/main.jsx
src/index.css
src/App.jsx
src/lib/db.js
src/lib/pdf.js
src/pages/Login.jsx
src/pages/Dashboard.jsx
src/pages/POList.jsx
src/pages/NewPO.jsx
src/pages/PODetail.jsx
src/pages/Compare.jsx
src/pages/Suppliers.jsx
src/pages/Items.jsx
src/pages/Users.jsx
src/components/Picker.jsx
src/components/PhotoStrip.jsx
src/components/ItemEditor.jsx
```

Typing `src/pages/Login.jsx` in the name box creates the `src` and `pages` folders for you.
It's 23 files — about 25 minutes of copy-paste. Do them in the order above so you don't lose track.

**Skip these:** the `supabase` folder (you already ran those in Part A) and
`.env.example` (Vercel handles that in Part C).

✅ **Part B done** when your repo shows `index.html`, `package.json` and a `src` folder.

---

# PART C — Vercel (puts it on the internet) · 15 minutes

1. Go to **vercel.com** → **Sign up with GitHub**
2. Click **Add New → Project**
3. Find `atlas-purchase` in the list → **Import**
4. It detects **Vite** automatically — don't change anything
5. Open **Environment Variables** and add two:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | your Project URL from step A6 |
| `VITE_SUPABASE_ANON_KEY` | your anon public key from step A6 |

   Type the names exactly — capital letters, underscores, no spaces.

6. Click **Deploy**
7. Wait 2 minutes. You get a link like `atlas-purchase.vercel.app`

**If the build fails:** click the failed build, read the red line. It almost always
says a file is missing — go back to GitHub and check you uploaded that file with
the right path and spelling. Capital letters matter: `Login.jsx`, not `login.jsx`.

✅ **Part C done.** Open the link. You should see the blue login screen.

---

# PART D — Your first login · 10 minutes

1. Open your Vercel link
2. Tap **New here? Create an account**
3. Enter your name, your email, a password → **Create account**
4. Go back to Supabase → **SQL Editor** → **New query**
5. Paste this, put your own email in, then **Run**:

```sql
update profiles
   set role = 'admin', full_name = 'Nowfal', approval_limit = 0
 where id = (select id from auth.users where email = 'your@email.com');
```

6. Go back to the app and **sign in**
7. You should now see **Suppliers, Items and Users** in the top menu

✅ You are the admin. Nobody else can do anything until you give them a role.

---

# PART E — Make it feel like an app · 5 minutes

**Android:** open the link in Chrome → ⋮ menu → **Add to Home screen**
**iPhone:** open the link in Safari → Share → **Add to Home Screen**

Staff get an icon on their phone. No Play Store, no App Store, no downloads.
When you update the code, everyone gets the update automatically — nothing to reinstall.

**Your own web address (optional, later):**
Vercel → your project → **Settings → Domains** → add `purchase.atlasmaharani.com`,
then add the DNS record it shows you at whoever hosts your domain.

---

# PART F — Add your people · 20 minutes

1. Send the link to your purchase team
2. Each person taps **Create an account** and signs up themselves
3. You open **Users** in the app and set for each one:
   - Role
   - Approval limit
   - Which entities they can see (tick none = they see all)

| Person | Role | Approval limit |
|---|---|---|
| Purchase executives | Purchase Executive | not an approver |
| Purchase manager | Purchase Manager | ₹50,000 |
| Purchase HOD | Purchase HOD | ₹2,00,000 |
| You | Admin / MD | 0 (no limit) |
| Accounts | Accounts | not an approver |

---

# PART G — Load your masters

Make two Excel files on your phone or in Google Sheets, then in the app use
**Suppliers → Import Excel** and **Items → Import Excel**.

**Supplier sheet — these exact column headings:**
```
Supplier Name | Company Name | GSTIN | Contact Person | Mobile | WhatsApp | Email | Address | Credit Days | Category
```

**Item sheet:**
```
Item Code | Item Name | Category | Sub Category | Model | Fabric | Brand | Selling Rate
```

Rules that save you months of trouble:
- One row per supplier — merge "ABC Textile" and "ABC Textiles" into one
- WhatsApp numbers: 10 digits, no +91, no spaces
- Item code format `LAD-KUR-00125`, decided once and never changed
- Start with your 500–1,000 repeat-purchase items, not all 20,000

The import screen shows you how many rows are blank or duplicate **before**
anything is saved, so a messy file cannot damage your data.

---

# Changing anything later — still no laptop

1. Open **github.com** → your repo → find the file
2. Tap the **pencil icon** → edit → **Commit changes**
3. Vercel rebuilds and puts the new version live in about 2 minutes, by itself

For approval limits, PO prefix and your company details on the PDF, you don't even
touch code — Supabase → **Table Editor** → `settings` → edit the row.

---

# If something goes wrong

| What you see | What to do |
|---|---|
| Login screen never loads, blank white page | The two environment variables in Vercel are wrong or misspelled. Fix them, then Vercel → Deployments → **Redeploy** |
| Vercel build fails | Read the red line — a file is missing or misspelled in GitHub. Check capital letters |
| Signed in but no menus | Your role isn't set. Run the Part D step 5 SQL again with the right email |
| "row-level security policy" error | That user's role or entity access isn't set in **Users** |
| Photos won't upload | The `po-photos` bucket doesn't exist, or `02_rls.sql` wasn't run |
| Import Excel does nothing | Column headings must match exactly, including spaces |
| Supplier list is empty when creating a PO | Suppliers must be marked **Active** |

---

# Your order of work

| Day | Do this |
|---|---|
| Day 1 | Part A — Supabase |
| Day 2 | Parts B and C — GitHub and Vercel, get the link working |
| Day 3 | Part D and E — your login, add to home screen |
| Day 4 | Start the supplier Excel — top 50 suppliers |
| Week 2 | Item Excel, then Parts F and G |
| Week 3 | Test everything yourself before showing anyone |
| Week 4 | Start the 3-shop pilot |

Do not add users before you have tested it yourself. First impressions decide
whether the purchase team uses this or works around it.
