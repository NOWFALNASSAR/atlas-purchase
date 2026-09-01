# Connecting Claude to your data

Three levels. Start at one, move up when you want to.

---

## Level 1 — Copy and paste (working today, free)

Already built. **Insights** in the menu.

The page works out warnings from your own data using rules, not guesses:
rate rises on repeat items, purchases below 25% margin, stock sitting in the
godown over two weeks, orders stuck in approval, supplier concentration.

Then **Copy summary for Claude** puts the figures on your clipboard. Open the
Claude app, paste, and ask anything:

> "Which suppliers should I renegotiate with first?"
> "Is my godown stock a problem or normal for this time of year?"
> "What three things should I fix this week?"

Add your own context when you paste — Onam is coming, a shop is
underperforming, a supplier has been unreliable. The answer gets much better.

**Why rules first, AI second.** The warnings are computed in SQL, so they are
always right and you can check any figure. The AI adds interpretation on top.
A model asked to find the anomalies itself would sometimes invent them.

**What gets copied:** totals, item names, supplier names, quantities and rates.
No phone numbers, no photos, no staff details, no customer information.

### To install

1. Run `supabase/09_insights.sql`
2. Add `src/pages/Insights.jsx` (new file)
3. Replace `src/App.jsx`

Visible to manager, HOD and admin.

---

## Level 2 — Weekly review, no code at all

Every Monday: Reports → Export Excel → upload the file to the Claude app → ask
for a review. Claude reads spreadsheets directly.

This handles far more detail than a pasted summary, and gives you a written
review to send your purchase HOD. Ten minutes a week, no development.

Do this for a month before building Level 3. You will find out what you
actually ask for, which is rarely what you expect.

---

## Level 3 — Claude inside the app

A **Supabase Edge Function** calls Claude's API, and a button in the app returns
a written summary on screen.

**The key rule: the API key lives in the Edge Function, never in the React app.**
Anything in the React code ships to every browser and can be read by anyone.

### Steps, all in the browser

1. Get an API key at **console.anthropic.com** → API Keys
2. Supabase → **Edge Functions** → **Create function** → name it `insights`
3. Paste the code below, deploy
4. Supabase → **Edge Functions → Secrets** → add `ANTHROPIC_API_KEY`

```ts
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

Deno.serve(async (req) => {
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // read only the small summary views — never raw tables
  const [month, rate, godown, pending] = await Promise.all([
    db.from('v_ai_month_summary').select('*'),
    db.from('v_ai_rate_alerts').select('*').limit(10),
    db.from('v_ai_godown_alerts').select('*').limit(10),
    db.from('v_ai_pending_alerts').select('*').limit(20)
  ])

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are reviewing purchase data for Atlas Maharani Group, a
multi-entity textile retailer in Kerala with 24 showrooms.

This month: ${JSON.stringify(month.data)}
Rate increases: ${JSON.stringify(rate.data)}
Godown stock: ${JSON.stringify(godown.data)}
Pending approvals: ${JSON.stringify(pending.data)}

Write a short briefing for the owner: what needs attention, what is going well,
and the three most useful actions this week. Be specific and use the numbers.
Do not invent anything that is not in the data. If something looks unclear,
say so rather than guessing.`
    }]
  })

  return new Response(JSON.stringify({ text: msg.content[0].text }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

Then call it from any page:

```js
const { data } = await db.functions.invoke('insights')
// data.text is the briefing
```

**Cost:** a few rupees per call. Even daily, a few hundred rupees a month.

### Rules worth keeping

- The AI reads the `v_ai_*` views only. Never raw tables, never a query it wrote
  itself. Then its numbers and your dashboard's numbers always agree.
- Never give it write access. It reports; people decide.
- Nothing it writes goes to a supplier or staff member without you reading it.
- Show the numbers next to the narrative so anything odd is visible.

---

## What to build when

| When | What |
|---|---|
| Now | Level 1. Use it daily during the pilot. |
| Week 2 | Level 2 weekly reviews. Note which questions you keep asking. |
| After a month of real data | Level 3, shaped around those questions. |
| Later | A daily morning briefing on a schedule. |

Don't build Level 3 first. Until you have a few months of orders, there isn't
enough history for the analysis to say anything you don't already know — and
you would be guessing at what to ask for.
