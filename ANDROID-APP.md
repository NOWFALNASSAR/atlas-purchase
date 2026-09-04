# Making Atlas a downloadable Android app

You already have the home-screen version. This is the other thing: a real
`.apk` file you can send on WhatsApp, or put on the Play Store.

## What it actually is

Android has a thing called a **Trusted Web Activity**. Your app gets a real
package name, a real icon in the app drawer, and appears in Settings →
Apps like any other app. Inside, it runs your website full screen with no
address bar.

This is how Twitter Lite, Uber and a lot of Indian business apps ship. It
is not a hack.

**What you gain over the home-screen version:** an installable file you
control, Play Store distribution, and it looks and updates like an app.

**What you do not gain:** it is the same code. Fixing a bug is still a
Vercel deploy — you do not rebuild the APK. That is the point.

---

## Before either route

Two things must be true, and both now are:

1. `manifest.webmanifest` with 192 and 512 icons — done
2. A service worker with a fetch handler — done

Deploy the current code first, then check these two open in a browser:

```
https://YOUR-DOMAIN/manifest.webmanifest
https://YOUR-DOMAIN/icons/icon-512.png
```

If either 404s, stop and fix that first.

---

## Route A — PWABuilder (no tools, 20 minutes)

Use this one. It runs in a browser and needs nothing installed.

**1.** Go to `https://www.pwabuilder.com`

**2.** Type your site address and press Start.

**3.** It scores your app. Manifest and service worker should both pass.

**4.** Package for stores → **Android** → Generate.

Set these:

| Field | Value |
|---|---|
| Package ID | `com.atlasmaharani.atlas` |
| App name | Atlas — Maharani Group |
| Launcher name | Atlas |
| Display mode | Standalone |
| Signing key | **Create new** |

Write down the package ID exactly. Changing it later means everyone
uninstalls and reinstalls.

**5.** Download the zip. Inside:

- `app-release-signed.apk` — send this to staff
- `app-release-bundle.aab` — only for the Play Store
- `signing.keystore` and `signing-key-info.txt`
- `assetlinks.json`

**6. Keep the keystore.** Back it up somewhere that is not one laptop.
Lose it and you can never update the app — Play Store will refuse a new
version signed with a different key, and sideloaded updates fail too.
Put it in your Google Drive today.

**7.** Open `assetlinks.json` from the zip. Copy the `sha256_cert_fingerprints`
value into `public/.well-known/assetlinks.json` in this project, replacing
`REPLACE_WITH_YOUR_SHA256_FINGERPRINT`. Commit and deploy.

**This step is what removes the address bar.** Skip it and the app works
but shows a browser bar across the top, which makes it look like a
shortcut rather than an app.

**8.** Check it published:

```
https://YOUR-DOMAIN/.well-known/assetlinks.json
```

It must show your fingerprint, not the placeholder.

**9.** Install the APK on a phone and open it. No address bar means it
worked. If there is one, the fingerprint is wrong or was not deployed —
Android caches this, so uninstall and reinstall to retest.

---

## Route B — Bubblewrap (on your own machine)

Only if you want the build local. Needs Java 17 and the Android SDK.

```bash
npm install -g @bubblewrap/cli

# uses the twa-manifest.json already in this project
# edit it first: replace REPLACE_WITH_YOUR_DOMAIN in all five places
bubblewrap init --manifest https://YOUR-DOMAIN/manifest.webmanifest
bubblewrap build
```

Then get the fingerprint for step 7 above:

```bash
keytool -list -v -keystore android.keystore -alias atlas | grep SHA256
```

---

## Giving it to staff

**By WhatsApp.** Send the `.apk` to your HOD group. Each person taps it,
Android warns about installing from an unknown source, they allow it once
for WhatsApp, and it installs. Fine for 30 people who know you.

**Play Store.** $25 once, then upload the `.aab`. Takes a few days for
review the first time. Worth it if you want automatic updates and no
scary warnings. Since it is a private business tool, use **Internal
testing** or a **closed track** rather than publishing publicly — you
add people by email and nobody else can find it.

---

## Updating

You do not rebuild the APK for a normal change. Deploy to Vercel and every
phone has it on next open.

Rebuild the APK only when you change the app name, the icon, the package
ID, or the shortcuts — and then bump `appVersionCode` in
`twa-manifest.json` first, or Android refuses the install.

---

## If the address bar will not go away

In order:

1. `https://YOUR-DOMAIN/.well-known/assetlinks.json` opens and shows your
   real fingerprint
2. The `package_name` in it matches the APK exactly
3. The fingerprint is SHA-**256**, not SHA-1
4. Uninstall and reinstall — Android caches the verification result

Test it against Google's own checker:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://YOUR-DOMAIN&relation=delegate_permission/common.handle_all_urls
```

---

## What is in this project already

| File | Why |
|---|---|
| `public/manifest.webmanifest` | name, icons, standalone mode |
| `public/sw.js` | required for installability; network-first |
| `public/icons/*` | 192, 512, maskable, apple-touch |
| `public/.well-known/assetlinks.json` | **needs your fingerprint** |
| `twa-manifest.json` | Bubblewrap config, route B |
| `vercel.json` | deep links work, assetlinks served as JSON |

`vercel.json` is new and matters beyond the app: without it, refreshing on
a page like `/tasks/eod` could 404. It also stops `sw.js` and `index.html`
being cached, which is what kept serving you stale code.

---

## One honest limitation

A TWA cannot do push notifications on iPhone, and on Android it needs Web
Push set up separately. The bell inside the app works either way, but the
phone will not buzz when a task arrives.

If buzzing matters more than anything else here, that is a different job —
Firebase Cloud Messaging plus a Capacitor wrapper instead of a TWA. Say so
and I will scope it. For now, staff see the count when they open the app.
