// Shared logic for the Game Day Bingo backend.
// Plain JavaScript with no imports, so the Supabase Edge Functions (Deno) and the
// Node tests in /tests can both load it.

export const SPORT_LABELS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB' };

// Researched squares are refreshed once when a game is this close to starting,
// so confirmed lineups and late scratches are picked up.
export const REFRESH_WINDOW_MS = 3 * 60 * 60 * 1000;
// A research job that has been "pending" longer than this is treated as stuck.
export const PENDING_TIMEOUT_MS = 4 * 60 * 1000;
export const MAX_REFRESHES = 1;

const MAX_SQUARE_CHARS = 44;
const MIN_TEAM_SQUARES = 8;
const MIN_TOTAL_SQUARES = 14;
const CATEGORIES = ['player', 'team', 'venue', 'storyline'];
const BANNED = [/injur/i, /\bhurt\b/i, /concussion/i, /\bbet\b/i, /betting/i, /\bodds\b/i, /spread/i, /parlay/i, /over\/under/i, /sportsbook/i, /\bdies?\b/i, /\bdeath\b/i];

// ---------- Schedule normalization (BALLDONTLIE responses) ----------

// BALLDONTLIE's NHL team objects have no separate nickname field.
const NHL_NICKNAMES = {
  ANA: 'Ducks', BOS: 'Bruins', BUF: 'Sabres', CGY: 'Flames', CAR: 'Hurricanes', CHI: 'Blackhawks',
  COL: 'Avalanche', CBJ: 'Blue Jackets', DAL: 'Stars', DET: 'Red Wings', EDM: 'Oilers', FLA: 'Panthers',
  LAK: 'Kings', MIN: 'Wild', MTL: 'Canadiens', NSH: 'Predators', NJD: 'Devils', NYI: 'Islanders',
  NYR: 'Rangers', OTT: 'Senators', PHI: 'Flyers', PIT: 'Penguins', SJS: 'Sharks', SEA: 'Kraken',
  STL: 'Blues', TBL: 'Lightning', TOR: 'Maple Leafs', UTA: 'Mammoth', VAN: 'Canucks', VGK: 'Golden Knights',
  WSH: 'Capitals', WPG: 'Jets'
};

// MLB nicknames by abbreviation, including the alternate codes some feeds use.
const MLB_NICKNAMES = {
  ARI: 'Diamondbacks', AZ: 'Diamondbacks', ATL: 'Braves', BAL: 'Orioles', BOS: 'Red Sox', CHC: 'Cubs',
  CWS: 'White Sox', CHW: 'White Sox', CIN: 'Reds', CLE: 'Guardians', COL: 'Rockies', DET: 'Tigers',
  HOU: 'Astros', KC: 'Royals', KCR: 'Royals', LAA: 'Angels', LAD: 'Dodgers', MIA: 'Marlins', MIL: 'Brewers',
  MIN: 'Twins', NYM: 'Mets', NYY: 'Yankees', ATH: 'Athletics', OAK: 'Athletics', PHI: 'Phillies',
  PIT: 'Pirates', SD: 'Padres', SDP: 'Padres', SF: 'Giants', SFG: 'Giants', SEA: 'Mariners', STL: 'Cardinals',
  TB: 'Rays', TBR: 'Rays', TEX: 'Rangers', TOR: 'Blue Jays', WSH: 'Nationals', WAS: 'Nationals', WSN: 'Nationals'
};

function mlbTeam(t, fallbackName) {
  const abbr = (t.abbreviation || '').toUpperCase();
  const full = t.display_name || t.full_name || fallbackName || '';
  const name = t.name || MLB_NICKNAMES[abbr] || fallbackName || full.split(' ').slice(-1)[0] || abbr;
  const city = t.location || (full && full.endsWith(name) ? full.slice(0, full.length - name.length).trim() : '');
  return { name, city, abbr, full: full || (city ? city + ' ' + name : name) };
}

function nhlTeam(t) {
  const abbr = t.tricode || t.abbreviation || '';
  const full = t.full_name || '';
  const name = NHL_NICKNAMES[abbr] || full.split(' ').slice(-1)[0] || abbr;
  const city = full && full.endsWith(name) ? full.slice(0, full.length - name.length).trim() : full;
  return { name, city: city || full, abbr, full: full || (city + ' ' + name) };
}

function stdTeam(t) {
  const city = t.location || t.city || '';
  const name = t.name || '';
  return { name, city, abbr: t.abbreviation || '', full: t.full_name || (city + ' ' + name).trim() };
}

/** Turns one BALLDONTLIE game into an `events` row (without research columns). */
export function normalizeGame(sport, g) {
  let home, away, startsAt, venue = null;
  if (sport === 'mlb') {
    home = mlbTeam(g.home_team || {}, g.home_team_name); away = mlbTeam(g.away_team || {}, g.away_team_name);
    startsAt = g.date || g.start_time_utc || g.datetime;
    venue = g.venue || null;
  } else if (sport === 'nhl') {
    home = nhlTeam(g.home_team || {}); away = nhlTeam(g.away_team || {});
    startsAt = g.start_time_utc || g.game_date;
    venue = g.venue || null;
  } else if (sport === 'nfl') {
    home = stdTeam(g.home_team || {}); away = stdTeam(g.visitor_team || {});
    startsAt = g.date;
    venue = g.venue || null;
  } else if (sport === 'nba') {
    home = stdTeam(g.home_team || {}); away = stdTeam(g.visitor_team || {});
    startsAt = g.datetime || (isIsoDateTime(g.status) ? g.status : g.date);
  } else {
    throw new Error('Unsupported sport: ' + sport);
  }
  return {
    id: sport + '-' + g.id,
    sport,
    provider_id: String(g.id),
    starts_at: new Date(startsAt).toISOString(),
    status_state: g.status_state || null,
    home_name: home.name, home_city: home.city, home_abbr: home.abbr, home_full: home.full,
    away_name: away.name, away_city: away.city, away_abbr: away.abbr, away_full: away.full,
    venue_name: venue,
    week: g.week || null,
    postseason: !!g.postseason
  };
}

function isIsoDateTime(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s); }

/** The UTC dates to ask the schedule API for, covering `hours` from `now`. */
export function datesToFetch(now, hours) {
  const out = [];
  const start = new Date(now.getTime() - 12 * 3600 * 1000);
  const end = new Date(now.getTime() + hours * 3600 * 1000);
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ---------- When to research ----------

/**
 * Decides what the generate-squares function should do for an event.
 * 'use'   - squares are ready and fresh; return them.
 * 'wait'  - another request is researching right now.
 * 'start' - research (or refresh) now.
 */
export function researchAction(ev, now) {
  const t = now.getTime();
  if (ev.squares_status === 'pending' && ev.pending_since && t - Date.parse(ev.pending_since) < PENDING_TIMEOUT_MS) return 'wait';
  if (ev.squares_status === 'ready') return needsRefresh(ev, now) ? 'start' : 'use';
  return 'start';
}

export function needsRefresh(ev, now) {
  if (ev.squares_status !== 'ready' || !ev.generated_at) return false;
  const start = Date.parse(ev.starts_at), t = now.getTime(), gen = Date.parse(ev.generated_at);
  const inWindow = start - t <= REFRESH_WINDOW_MS && start > t;
  const stale = gen < start - REFRESH_WINDOW_MS;
  return inWindow && stale && (ev.refresh_count || 0) < MAX_REFRESHES;
}

// ---------- Prompt ----------

// Extra research and calibration notes per sport.
const SPORT_GUIDANCE = {
  mlb: [
    'Baseball specifics:',
    '- Confirm the probable starting pitchers, and whether either team plans an opener or a bullpen game.',
    '- Use the posted lineups if they are out (usually 3-4 hours before first pitch). If they are not, only name everyday starters who are healthy.',
    '- Check which relievers have pitched a lot in the last few days, who closes, and hot and cold hitters over the last two weeks.',
    '- Look for milestones (such as a player one home run from 30), streaks, ABS challenge habits, and the ballpark’s features and traditions.',
    '- For open-air ballparks, check the weather forecast; rain or wind can be a square.',
    '- Calibrate tiers: a regular hitter getting a hit is likely (about 65-75%); a specific player homering is a long shot (about 10-20%, up to about 30% for the top sluggers); a starter beating his usual strikeout total is a toss-up; a specific player stealing a base is usually a long shot unless he steals often.',
    '- Good squares look like: "Skubal strikes out 8+", "Judge homers", "Chisholm steals a base", "Ball hits the Green Monster", "Closer earns the save".'
  ].join('\n')
};

export function buildPrompt(ev, now) {
  const league = SPORT_LABELS[ev.sport] || ev.sport.toUpperCase();
  const start = new Date(ev.starts_at);
  const et = start.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const system = [
    'You research one upcoming ' + league + ' game and write bingo squares for fans watching it on TV.',
    '',
    'Research with web search before writing. Look for information published in the last few days:',
    '- who is expected to play, and who is out, doubtful or suspended (check the latest injury report)',
    '- starting quarterbacks, starting goalies or starting lineups, when known',
    '- both teams’ records, recent results and streaks',
    '- milestones a player is close to, rivalry history and the storylines previews are talking about',
    '- the venue, its traditions, and the TV broadcast',
    'Prefer league and team sites and major outlets such as ESPN, AP, CBS Sports, NBC Sports, NFL.com, NBA.com and NHL.com.',
    '',
    'Rules for squares:',
    '- Each square is something a viewer can see happen, or hear mentioned on the broadcast, during this game. Never a fact that is already true before the game.',
    '- Keep each square to 6 words or fewer and at most 40 characters. Use last names for players.',
    '- Only name players you confirmed are expected to play. Never name a player who is out, doubtful, suspended or no longer on the team.',
    '- Do not write squares about injuries, fights in the stands, betting, odds or point spreads, or anything mean about a person.',
    '- Do not repeat plain events that happen in most games, such as "Touchdown pass" or "Power play". Make every square specific to these teams, players, venue or storylines.',
    '- tier: 1 = likely (over 70% in this game), 2 = toss-up (30-70%), 3 = long shot (under 30%). Base it on recent stats.',
    '- team: "home" or "away" for a square about one team or its players, otherwise null.',
    '- Write 10-14 player squares split evenly between the teams, 4-6 team squares, 2-4 venue or broadcast squares, and 4-6 storyline squares.',
    '',
    SPORT_GUIDANCE[ev.sport] || '',
    '',
    'After researching, first write a short summary of what you found (5-8 sentences), then finish with only a JSON object in a ```json code block, in this shape:',
    '{"venue": {"name": "...", "city": "..."},',
    ' "facts": [{"label": "Starting QBs", "value": "..."}, {"label": "Records", "value": "..."}, {"label": "TV", "value": "..."}],',
    ' "squares": [{"text": "...", "tier": 2, "category": "player", "team": "home"}]}',
    'category is one of "player", "team", "venue", "storyline". Give at most 4 facts, each value under 80 characters.'
  ].join('\n');
  const user = [
    'Game: ' + ev.away_full + ' at ' + ev.home_full + ' (' + league + ')',
    'Home team: ' + ev.home_full + '. Away team: ' + ev.away_full + '.',
    'Starts: ' + et + ' Eastern (' + ev.starts_at + ' UTC)',
    ev.venue_name ? 'Venue: ' + ev.venue_name : 'Venue: find it',
    'Today is ' + now.toISOString().slice(0, 10) + '.'
  ].join('\n');
  return { system, user };
}

// ---------- Parsing the model's answer ----------

export function extractText(content) {
  return (content || []).filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('');
}

export function parseModelJson(text) {
  if (!text) throw new Error('The model returned no text.');
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.length ? [fences[fences.length - 1][1]] : [];
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch (e) { /* try the next candidate */ }
  }
  throw new Error('Could not find a JSON object in the model’s answer.');
}

function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^["'“]|["'”]$/g, '').trim().slice(0, max);
}

/**
 * Checks and cleans the model's JSON. Squares that break a rule are dropped;
 * the whole result fails only when too few good squares are left.
 */
export function validateResearch(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Answer was not an object.'] };
  const seen = new Set();
  const squares = [];
  for (const raw of Array.isArray(obj.squares) ? obj.squares : []) {
    if (!raw || typeof raw !== 'object') continue;
    const text = cleanText(raw.text, 120);
    const key = text.toLowerCase();
    const tier = Number(raw.tier);
    const category = String(raw.category || '').toLowerCase();
    const team = raw.team === 'home' || raw.team === 'away' ? raw.team : null;
    if (!text) continue;
    if (text.length > MAX_SQUARE_CHARS) { errors.push('Too long: ' + text); continue; }
    if (BANNED.some(function (re) { return re.test(text); })) { errors.push('Not allowed: ' + text); continue; }
    if (![1, 2, 3].includes(tier)) { errors.push('Bad tier: ' + text); continue; }
    if (!CATEGORIES.includes(category)) { errors.push('Bad category: ' + text); continue; }
    if ((category === 'player' || category === 'team') && !team) { errors.push('Missing team: ' + text); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    squares.push({ text, tier, category, team });
  }
  const teamSquares = squares.filter(function (s) { return s.category === 'player' || s.category === 'team'; });
  const homeN = teamSquares.filter(function (s) { return s.team === 'home'; }).length;
  const awayN = teamSquares.length - homeN;
  if (teamSquares.length < MIN_TEAM_SQUARES) errors.push('Only ' + teamSquares.length + ' team or player squares.');
  if (squares.length < MIN_TOTAL_SQUARES) errors.push('Only ' + squares.length + ' usable squares.');
  if (homeN < 3 || awayN < 3) errors.push('Squares are lopsided: ' + homeN + ' home, ' + awayN + ' away.');

  const facts = (Array.isArray(obj.facts) ? obj.facts : []).slice(0, 4).map(function (f) {
    return { label: cleanText(f && f.label, 24), value: cleanText(f && f.value, 90) };
  }).filter(function (f) { return f.label && f.value && !BANNED.some(function (re) { return re.test(f.value); }); });

  const venue = obj.venue && typeof obj.venue === 'object'
    ? { name: cleanText(obj.venue.name, 60) || null, city: cleanText(obj.venue.city, 40) || null }
    : { name: null, city: null };

  const ok = teamSquares.length >= MIN_TEAM_SQUARES && squares.length >= MIN_TOTAL_SQUARES && homeN >= 3 && awayN >= 3;
  return { ok, research: { squares, facts, venue }, errors };
}

/** Pages the model cited, for the "Researched from" list. Uses citations, never URLs the model typed. */
export function collectSources(content, max) {
  const out = [], seen = new Set();
  for (const b of content || []) {
    if (!b || b.type !== 'text' || !Array.isArray(b.citations)) continue;
    for (const c of b.citations) {
      if (!c || !c.url || seen.has(c.url)) continue;
      if (!/^https?:\/\//.test(c.url)) continue;
      seen.add(c.url);
      out.push({ title: cleanText(c.title || c.url, 120), url: c.url });
      if (out.length >= (max || 10)) return out;
    }
  }
  if (out.length) return out;
  // No citations came back: fall back to the pages the searches returned.
  for (const b of content || []) {
    if (!b || b.type !== 'web_search_tool_result' || !Array.isArray(b.content)) continue;
    for (const r of b.content) {
      if (!r || !r.url || seen.has(r.url) || !/^https?:\/\//.test(r.url)) continue;
      seen.add(r.url);
      out.push({ title: cleanText(r.title || r.url, 120), url: r.url });
      if (out.length >= (max || 10)) return out;
    }
  }
  return out;
}
