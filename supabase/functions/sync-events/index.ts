// sync-events: pulls schedules for the next 36 hours into `events`. Baseball only for now;
// set the SPORTS secret (for example "mlb,nfl") to add other leagues later.
// Run hourly by pg_cron (see SETUP.md). Requires the x-cron-secret header.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeGame, datesToFetch } from '../_shared/research.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BDL_KEY = Deno.env.get('BALLDONTLIE_API_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const SPORTS = (Deno.env.get('SPORTS') ?? 'mlb').split(',').map((s) => s.trim()).filter(Boolean);
const WINDOW_HOURS = Number(Deno.env.get('WINDOW_HOURS') ?? '36');

const PATHS: Record<string, string> = { mlb: '/mlb/v1/games', nfl: '/nfl/v1/games', nba: '/nba/v1/games', nhl: '/nhl/v1/games' };

async function fetchGames(sport: string, dates: string[]) {
  const all: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://api.balldontlie.io' + PATHS[sport]);
    for (const d of dates) url.searchParams.append('dates[]', d);
    url.searchParams.set('per_page', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: BDL_KEY } });
    if (!res.ok) throw new Error(sport.toUpperCase() + ' schedule: HTTP ' + res.status);
    const body = await res.json();
    all.push(...(body.data ?? []));
    cursor = body.meta?.next_cursor ? String(body.meta.next_cursor) : null;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 13_000)); // free tier allows 5 requests a minute
  }
  return all;
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date();
  const dates = datesToFetch(now, WINDOW_HOURS);
  const report: Record<string, unknown> = { dates };

  for (const sport of SPORTS) {
    if (!PATHS[sport]) continue;
    try {
      const games = await fetchGames(sport, dates);
      const rows = games.map((g) => normalizeGame(sport, g))
        .filter((r) => !isNaN(Date.parse(r.starts_at)))
        .map((r) => {
          const row: Record<string, unknown> = { ...r, updated_at: now.toISOString() };
          // NBA schedules have no venue; don't erase one the research filled in.
          if (row.venue_name == null) delete row.venue_name;
          return row;
        });
      // Upsert schedule columns only; research columns keep their values.
      if (rows.length) {
        const { error } = await db.from('events').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      report[sport] = rows.length;
    } catch (e) {
      report[sport] = 'error: ' + (e instanceof Error ? e.message : String(e));
    }
    await new Promise((r) => setTimeout(r, 13_000));
  }

  // Drop games that ended more than two days ago.
  await db.from('events').delete().lt('starts_at', new Date(now.getTime() - 2 * 86400_000).toISOString());
  return new Response(JSON.stringify(report), { headers: { 'Content-Type': 'application/json' } });
});
