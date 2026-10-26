// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGame, datesToFetch, researchAction, needsRefresh, buildPrompt,
  parseModelJson, validateResearch, collectSources, extractText,
} from '../supabase/functions/_shared/research.js';

const baseEvent = {
  id: 'nfl-1', sport: 'nfl', starts_at: '2026-11-01T17:00:00.000Z',
  home_full: 'Buffalo Bills', away_full: 'Baltimore Ravens', venue_name: 'Highmark Stadium',
  squares_status: 'none', refresh_count: 0,
};

test('normalizes NFL, NBA and NHL games', () => {
  const nfl = normalizeGame('nfl', { id: 7, date: '2026-11-01T17:00:00.000Z', venue: 'Highmark Stadium', status_state: 'scheduled', week: 8,
    home_team: { location: 'Buffalo', name: 'Bills', abbreviation: 'BUF', full_name: 'Buffalo Bills' },
    visitor_team: { location: 'Baltimore', name: 'Ravens', abbreviation: 'BAL', full_name: 'Baltimore Ravens' } });
  assert.equal(nfl.id, 'nfl-7');
  assert.equal(nfl.home_name, 'Bills');
  assert.equal(nfl.away_city, 'Baltimore');
  assert.equal(nfl.venue_name, 'Highmark Stadium');

  const nba = normalizeGame('nba', { id: 9, date: '2026-10-27', datetime: '2026-10-27T23:30:00Z', status: 'scheduled',
    home_team: { city: 'Boston', name: 'Celtics', abbreviation: 'BOS', full_name: 'Boston Celtics' },
    visitor_team: { city: 'New York', name: 'Knicks', abbreviation: 'NYK', full_name: 'New York Knicks' } });
  assert.equal(nba.starts_at, '2026-10-27T23:30:00.000Z');
  assert.equal(nba.venue_name, null);

  const nhl = normalizeGame('nhl', { id: 3, start_time_utc: '2026-10-27T23:00:00Z', venue: 'Scotiabank Arena', status_state: 'scheduled',
    home_team: { full_name: 'Toronto Maple Leafs', tricode: 'TOR' }, away_team: { full_name: 'Utah Mammoth', tricode: 'UTA' } });
  assert.equal(nhl.home_name, 'Maple Leafs');
  assert.equal(nhl.home_city, 'Toronto');
  assert.equal(nhl.away_name, 'Mammoth');
});

test('date window covers 36 hours ahead', () => {
  const d = datesToFetch(new Date('2026-10-26T18:00:00Z'), 36);
  assert.deepEqual(d, ['2026-10-26', '2026-10-27', '2026-10-28']);
});

test('research decisions', () => {
  const now = new Date('2026-11-01T06:00:00Z');
  assert.equal(researchAction(baseEvent, now), 'start');
  assert.equal(researchAction({ ...baseEvent, squares_status: 'pending', pending_since: '2026-11-01T05:58:30Z' }, now), 'wait');
  assert.equal(researchAction({ ...baseEvent, squares_status: 'pending', pending_since: '2026-11-01T05:00:00Z' }, now), 'start');
  const ready = { ...baseEvent, squares_status: 'ready', generated_at: '2026-11-01T05:00:00Z' };
  assert.equal(researchAction(ready, now), 'use');
  // Two hours before kickoff, squares written 12 hours earlier get one refresh.
  const close = new Date('2026-11-01T15:00:00Z');
  assert.equal(needsRefresh(ready, close), true);
  assert.equal(researchAction(ready, close), 'start');
  assert.equal(researchAction({ ...ready, refresh_count: 1 }, close), 'use');
  // Squares written inside the window are fresh.
  assert.equal(needsRefresh({ ...ready, generated_at: '2026-11-01T14:30:00Z' }, close), false);
});

test('prompt names both teams and the start time', () => {
  const { system, user } = buildPrompt(baseEvent, new Date('2026-10-30T12:00:00Z'));
  assert.match(user, /Baltimore Ravens at Buffalo Bills/);
  assert.match(user, /Sunday, November 1, 2026/);
  assert.match(system, /```json/);
});

function goodAnswer() {
  const sq = [];
  for (let i = 0; i < 6; i++) sq.push({ text: 'Allen play ' + i, tier: 2, category: 'player', team: 'home' });
  for (let i = 0; i < 6; i++) sq.push({ text: 'Jackson play ' + i, tier: 1, category: 'player', team: 'away' });
  sq.push({ text: 'Bills fans sing Shout', tier: 1, category: 'venue', team: null });
  sq.push({ text: 'Broadcast mentions the AFC race', tier: 2, category: 'storyline', team: null });
  sq.push({ text: 'Henry runs for 100+ yards', tier: 2, category: 'player', team: 'away' });
  return { venue: { name: 'Highmark Stadium', city: 'Orchard Park' }, facts: [{ label: 'TV', value: 'CBS' }], squares: sq };
}

test('parses the JSON block at the end of the answer', () => {
  const text = 'Summary of findings.\n```json\n' + JSON.stringify(goodAnswer()) + '\n```';
  assert.equal(parseModelJson(text).venue.city, 'Orchard Park');
  assert.throws(() => parseModelJson('no json here'));
});

test('validation keeps good squares and drops bad ones', () => {
  const a = goodAnswer();
  a.squares.push({ text: 'Allen gets injured', tier: 3, category: 'player', team: 'home' });
  a.squares.push({ text: 'Bills cover the spread', tier: 2, category: 'team', team: 'home' });
  a.squares.push({ text: 'This square text is far too long to fit inside a bingo cell', tier: 2, category: 'storyline', team: null });
  a.squares.push({ text: 'Allen play 1', tier: 2, category: 'player', team: 'home' });
  a.squares.push({ text: 'No team given', tier: 2, category: 'player', team: null });
  const r = validateResearch(a);
  assert.equal(r.ok, true);
  assert.equal(r.research.squares.length, 15);
  assert.ok(!r.research.squares.some((s) => /injured|spread/.test(s.text)));
});

test('validation fails when too few squares survive', () => {
  const r = validateResearch({ squares: [{ text: 'Allen TD', tier: 1, category: 'player', team: 'home' }] });
  assert.equal(r.ok, false);
});

test('sources come from citations, falling back to search results', () => {
  const content = [
    { type: 'server_tool_use', name: 'web_search', input: { query: 'x' } },
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.espn.com/a', title: 'ESPN preview' }] },
    { type: 'text', text: 'Allen is healthy.', citations: [{ type: 'web_search_result_location', url: 'https://www.nfl.com/b', title: 'NFL.com' }] },
    { type: 'text', text: '```json {} ```' },
  ];
  assert.deepEqual(collectSources(content), [{ title: 'NFL.com', url: 'https://www.nfl.com/b' }]);
  assert.deepEqual(collectSources(content.slice(0, 2)), [{ title: 'ESPN preview', url: 'https://www.espn.com/a' }]);
  assert.equal(extractText(content), 'Allen is healthy.```json {} ```');
});
