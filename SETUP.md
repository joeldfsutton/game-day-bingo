# Turning on sign-in, live schedules and researched squares

Until these steps are done, the site runs in **demo mode**: it shows the featured games in `data/games.json` with standard squares, and anyone can print cards.

The live version uses three outside services:

| Service | What it does | Cost |
| --- | --- | --- |
| [Supabase](https://supabase.com) | Sign-in by email link, the database, and two small server functions | Free tier is enough to start |
| [Claude API](https://platform.claude.com) | Researches each game with web search and writes its squares | Pay as you go, roughly $0.15–0.50 per game (see below) |
| [BALLDONTLIE](https://www.balldontlie.io) | MLB schedules | Check which plan includes MLB games before you sign up. For other leagues, games were free (NFL) or on the $9.99-a-month ALL-STAR plan (NHL) |

Plan on about 45 minutes. Steps 1–4 happen in web dashboards; step 5 lets GitHub deploy the server code for you.

## 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and select **New project**. Pick a region near most of your players and save the database password somewhere safe.
2. When it finishes, open **Project Settings → API** and note two values:
   - **Project URL**, like `https://abcdefgh.supabase.co`. The `abcdefgh` part is your **project ref**.
   - **anon public** key.

## 2. Create the database tables

1. Open **SQL Editor → New query**.
2. Paste everything in `supabase/migrations/20261026000000_init.sql` and select **Run**.

This creates the `events` table (the schedule and each game's researched squares) and a `generation_log` table that tracks research for spending limits. Browsers can read `events` but can't write anything; only the server functions can.

## 3. Get the API keys

- **Claude API key:** at [platform.claude.com](https://platform.claude.com), add billing, then create a key under **API keys**. Set a monthly spend limit under **Limits** while you're there.
- **BALLDONTLIE key:** sign up at [balldontlie.io](https://www.balldontlie.io), make sure your plan includes the MLB **Games** endpoint, and copy your key. There's no rush: no games come back until spring training in late February.
- **Cron secret:** make up a long random string, such as the output of `openssl rand -hex 24`. It stops strangers from triggering the schedule sync.

## 4. Add the keys to Supabase

Open **Edge Functions → Secrets** (sometimes under **Project Settings → Edge Functions**) and add:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `BALLDONTLIE_API_KEY` | Your BALLDONTLIE key |
| `CRON_SECRET` | The random string from step 3 |
| `ALLOWED_ORIGIN` | `https://joeldfsutton.github.io` |
| `SPORTS` | Optional. Defaults to `mlb`. The code also supports `nfl`, `nba` and `nhl` for later |
| `MAX_RESEARCH_PER_DAY` | Optional. Defaults to `100` games a day across all users |
| `MAX_RESEARCH_PER_USER_PER_HOUR` | Optional. Defaults to `6` |
| `CLAUDE_MODEL` | Optional. Defaults to `claude-sonnet-5-5` |

## 5. Deploy the server functions from GitHub

1. In Supabase, open your account menu → **Access Tokens** and create a token.
2. In this GitHub repository, open **Settings → Secrets and variables → Actions**:
   - Under **Secrets**, add `SUPABASE_ACCESS_TOKEN` with that token.
   - Under **Variables**, add `SUPABASE_PROJECT_REF` with your project ref.
3. Open the **Actions** tab, pick **Backend**, and select **Run workflow**.

From then on, every push that changes `supabase/` runs the tests and redeploys the functions.

## 6. Schedule the hourly game list

1. In Supabase, open **Database → Extensions** and turn on `pg_cron` and `pg_net`.
2. In the SQL Editor, run this after replacing `YOUR_REF` and `YOUR_CRON_SECRET`:

```sql
select cron.schedule(
  'sync-events-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_REF.supabase.co/functions/v1/sync-events',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

3. To fill the list right away instead of waiting for the next hour, run just the `select net.http_post(...)` part once.

## 7. Turn on sign-in

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://joeldfsutton.github.io/game-day-bingo/` and add the same address under **Redirect URLs**.
3. Email sign-in is on by default. Supabase's built-in email sender only allows a few emails an hour, which is fine for testing. Before you share the site widely, add your own email service under **Authentication → Emails → SMTP Settings**.

## 8. Connect the site

Put your Project URL and anon key in `js/config.js` and push. Both are safe to publish: the anon key can only do what the database rules allow. If you send them to Claude, Claude can make this change for you.

## What research costs

Each researched game makes up to 8 web searches ($10 per 1,000 searches) and reads the pages they return with Claude Sonnet 5.5 ($2 per million input tokens, $10 per million output tokens). That's roughly **$0.15–0.25 per game**. A game that's researched more than 3 hours before it starts is refreshed once inside that window to pick up lineups, so a popular game can cost up to about twice that.

Everyone who picks the same game shares one set of squares, so cost grows with the number of different games people pick, not the number of players. A full MLB day has about 15 games, so even if every game gets picked and refreshed, research costs about **$3–8 a day**, or roughly $100–225 a month during the season. Spring training days can have more games. The default limit of 100 games a day is a safety cap you're unlikely to reach with baseball alone.

Pricing from [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing), checked October 2026.
