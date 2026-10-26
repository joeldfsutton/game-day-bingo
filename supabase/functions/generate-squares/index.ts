// generate-squares: researches one event with Claude + web search and stores the squares.
// Called by signed-in visitors with {"event_id": "..."}. The first request for an event
// does the research; everyone after that gets the stored squares.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  buildPrompt, extractText, parseModelJson, validateResearch, collectSources, researchAction,
} from '../_shared/research.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-sonnet-5-5';
const MAX_SEARCHES = Number(Deno.env.get('MAX_SEARCHES_PER_EVENT') ?? '8');
const MAX_PER_DAY = Number(Deno.env.get('MAX_RESEARCH_PER_DAY') ?? '100');
const MAX_PER_USER_HOUR = Number(Deno.env.get('MAX_RESEARCH_PER_USER_PER_HOUR') ?? '6');
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const PUBLIC_COLUMNS = 'id,sport,starts_at,status_state,home_name,home_city,home_abbr,home_full,away_name,away_city,away_abbr,away_full,venue_name,venue_city,week,postseason,squares_status,squares,facts,sources,generated_at,refresh_count';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  // 1. Who is asking? Only signed-in users may start research.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Sign in to make cards.' }, 401);

  let eventId = '';
  try { eventId = String((await req.json()).event_id ?? ''); } catch { /* handled below */ }
  if (!eventId) return json({ error: 'Missing event_id.' }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: ev, error: evErr } = await db.from('events').select('*').eq('id', eventId).maybeSingle();
  if (evErr) return json({ error: evErr.message }, 500);
  if (!ev) return json({ error: 'That game is no longer on the schedule.' }, 404);

  const now = new Date();
  const action = researchAction(ev, now);
  if (action === 'use' || action === 'wait') return json({ event: pick(ev), status: action === 'use' ? 'ready' : 'pending' });

  // 2. Spending limits.
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const [{ count: userCount }, { count: dayCount }] = await Promise.all([
    db.from('generation_log').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', hourAgo),
    db.from('generation_log').select('id', { count: 'exact', head: true }).gte('created_at', dayAgo),
  ]);
  if ((dayCount ?? 0) >= MAX_PER_DAY) return json({ event: pick(ev), status: 'limited', error: 'Research is paused for today. Cards use standard squares until tomorrow.' }, 429);
  if ((userCount ?? 0) >= MAX_PER_USER_HOUR) return json({ event: pick(ev), status: 'limited', error: 'You’ve researched several games this hour. Try again later.' }, 429);
  if (!ANTHROPIC_API_KEY) return json({ event: pick(ev), status: 'failed', error: 'Research isn’t set up yet (no API key).' }, 503);

  // 3. Claim the event so two visitors don't pay for the same research.
  const staleBefore = new Date(now.getTime() - 4 * 60_000).toISOString();
  const { data: claimed } = await db.from('events')
    .update({ squares_status: 'pending', pending_since: now.toISOString(), error: null })
    .eq('id', eventId)
    .or(`squares_status.neq.pending,pending_since.lt."${staleBefore}"`)
    .select('id');
  if (!claimed || claimed.length === 0) return json({ event: pick(ev), status: 'pending' });

  // 4. Research.
  try {
    const result = await research(ev, now);
    const refreshing = ev.squares_status === 'ready';
    const update = {
      squares_status: 'ready',
      squares: result.research.squares,
      facts: result.research.facts,
      sources: result.sources,
      venue_name: ev.venue_name ?? result.research.venue.name,
      venue_city: ev.venue_city ?? result.research.venue.city,
      generated_at: new Date().toISOString(),
      pending_since: null,
      refresh_count: refreshing ? (ev.refresh_count ?? 0) + 1 : ev.refresh_count ?? 0,
      error: result.warnings.length ? result.warnings.slice(0, 5).join(' | ') : null,
      updated_at: new Date().toISOString(),
    };
    const { data: saved } = await db.from('events').update(update).eq('id', eventId).select(PUBLIC_COLUMNS).single();
    await db.from('generation_log').insert({ event_id: eventId, user_id: user.id, outcome: 'ready', searches: result.searches, input_tokens: result.usage.input, output_tokens: result.usage.output });
    return json({ event: saved, status: 'ready' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Keep earlier squares if this was a refresh that failed.
    const fallbackStatus = ev.squares_status === 'ready' ? 'ready' : 'failed';
    await db.from('events').update({ squares_status: fallbackStatus, pending_since: null, error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', eventId);
    await db.from('generation_log').insert({ event_id: eventId, user_id: user.id, outcome: 'failed' });
    return json({ event: pick({ ...ev, squares_status: fallbackStatus }), status: fallbackStatus, error: 'Research didn’t finish. Cards use standard squares for this game.' }, fallbackStatus === 'ready' ? 200 : 502);
  }
});

function pick(ev: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_COLUMNS.split(',')) out[k] = ev[k];
  return out;
}

async function callClaude(body: Record<string, unknown>) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Claude API error ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return await res.json();
}

async function research(ev: Record<string, unknown>, now: Date) {
  const { system, user } = buildPrompt(ev, now);
  const messages: Array<Record<string, unknown>> = [{ role: 'user', content: user }];
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }];
  let allContent: Array<Record<string, unknown>> = [];
  const usage = { input: 0, output: 0 };
  let searches = 0;

  // A long search turn can come back as `pause_turn`; send it back unchanged to continue.
  for (let round = 0; round < 4; round++) {
    const msg = await callClaude({ model: MODEL, max_tokens: 6000, system, messages, tools });
    usage.input += msg.usage?.input_tokens ?? 0;
    usage.output += msg.usage?.output_tokens ?? 0;
    searches += msg.usage?.server_tool_use?.web_search_requests ?? 0;
    allContent = allContent.concat(msg.content ?? []);
    if (msg.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content });
  }

  const parsed = parseModelJson(extractText(allContent));
  const checked = validateResearch(parsed);
  if (!checked.ok) throw new Error('Squares failed checks: ' + checked.errors.slice(0, 4).join('; '));
  return { research: checked.research!, warnings: checked.errors, sources: collectSources(allContent, 10), usage, searches };
}
