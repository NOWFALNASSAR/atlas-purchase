# Update 14 — One app, four screen sizes, and a new look

The app was built phone-first, and on a phone it was fine. On a laptop it
was a narrow column of content with a lot of empty grey either side, and on
a tablet it was a stretched phone. This update makes each size deliberate.

## The layout, by size

| Width | Device | Navigation | Content |
|---|---|---|---|
| under 768 | phone | header + bottom bar, full menu behind the ☰ | one column, 16px inputs |
| 768–1023 | tablet | icon rail down the left | wider, two columns where it helps |
| 1024–1535 | laptop | full sidebar with module and page links | wide tables, denser rows |
| 1536 and up | desktop / TV | same sidebar | capped at 1560px so lines stay readable |

The sidebar collapses to icons with the button at its foot, and remembers
your choice on that device. It starts collapsed on a tablet and open on a
laptop.

**Forms stay narrow at every size.** A 1400px-wide text field is not easier
to fill in than a 500px one. Only tables and dashboards take the extra room.

## Three fixes that matter more than they sound

**Inputs are 16px on phones.** Under 16px, iOS zooms the whole page when a
field is tapped, and the purchase team then has to pinch back out on every
line of every order. Above 767px they drop to 14px for density.

**Tables scroll instead of squeezing.** A six-column rate table on a 360px
phone used to compress every column until the figures were unreadable. Now
the table keeps its natural width, the card scrolls sideways, and the first
column stays pinned so you always know which row you are reading.

**All figures are tabular.** Digits now occupy identical widths, so rates
line up down a column and you can see at a glance that 1,240 is bigger than
980. It costs nothing and it is the difference between a spreadsheet and a
web page.

## The theme

Corporate, quiet, and built for people who look at it for eight hours.

- **Navy `#0E1B2E`** — sidebar, primary buttons, headings. Deeper and less
  blue than before.
- **Brass `#A97721`** — the single accent. It was used freely before; now it
  appears only on the current item and on money-critical states, so seeing it
  means something.
- **Neutrals** — `#F4F6F9` canvas, `#E2E6EC` rules, `#5B6879` secondary text.
  Low chroma throughout, so the numbers are the most colourful thing on screen.
- **Green `#12704E` / red `#A4362B`** for approved and rejected, dark enough
  to read on white.

Form labels are sentence case now, not uppercase. Shadows are almost invisible
— a 1px border does the work. No web font is loaded, deliberately: a font file
is a bad thing to wait for on shop wifi, and the system stack renders instantly
on every device your staff own.

## How the retheme was done

The colour names in `tailwind.config.js` are unchanged — `ink`, `slate2`,
`line`, `paper`, `gold`, `good`, `bad`. All 26 pages already use them, so
changing the values retheme the whole app without touching a single page.

If you want to adjust anything later, change it in `tailwind.config.js` and
`src/index.css`. Those two files are the design system now.

## What changed in the files

| File | Change |
|---|---|
| `tailwind.config.js` | new palette, type scale, breakpoints, shadows |
| `src/index.css` | rewritten: responsive components, table rules, focus states |
| `src/App.jsx` | new shell — sidebar, tablet rail, phone drawer, breadcrumb |
| `src/pages/Login.jsx` | split layout on laptop instead of a centred box |
| `src/components/EntityBar.jsx` | restyled as a segmented control |
| `index.html` | theme colour, home-screen meta |
| all 26 pages | container classes swapped to `page page-sm/md/lg/xl` |

The page swap was mechanical: `mx-auto max-w-2xl` became `page page-md` and
so on. No page logic was touched.

## Check it yourself

Open the deployed URL and drag the browser window from narrow to wide. The
layout should change twice — at 768 and at 1024 — and nothing should overlap
or scroll sideways at any width in between.

Then on a real phone:

| # | Test | Must happen |
|---|---|---|
| 1 | Tap a rate field on iPhone Safari | Page does not zoom |
| 2 | Open a rate table on a 360px phone | Table scrolls sideways, first column stays put |
| 3 | Tap ☰ | Full menu opens, every module listed |
| 4 | Rotate a tablet to portrait | Icon rail, no bottom bar, nothing clipped |
| 5 | Open Roles on a phone and change a tick | Save bar sits above the bottom bar, not under it |
| 6 | Collapse the sidebar on a laptop, reload | Stays collapsed |

Test 1 and 2 are the ones the purchase team will notice within a day.
