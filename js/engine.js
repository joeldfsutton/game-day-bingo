// Card engine: builds the square pool for a game and deals unique, balanced cards.
(function () {
  'use strict';

  var CATS = { team: 'Teams & players', venue: 'Venue & broadcast', story: 'This game’s storylines', generic: 'Any game' };
  var TIERS = { 1: 'Likely', 2: 'Toss-up', 3: 'Long shot' };
  var DIFF = {
    easy: { w: { 1: .6, 2: .37, 3: .03 }, t3: 2, t1f: .5, hint: 'About half the squares are likely to happen. Expect a bingo midway through.' },
    standard: { w: { 1: .38, 2: .5, 3: .12 }, t3: 4, t1f: .36, hint: 'A mix of likely plays and toss-ups, plus about 4 long shots. Bingos usually come late.' },
    long: { w: { 1: .25, 2: .45, 3: .3 }, t3: 7, t1f: .24, hint: 'Lots of toss-ups and about 7 long shots. Some games nobody wins.' }
  };
  var MIN_SPECIFIC = 9;
  var LINES = (function () {
    var L = [], r, c;
    for (r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map(function (x) { return r * 5 + x; }));
    for (c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map(function (x) { return x * 5 + c; }));
    L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
    return L;
  })();

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pickOne(a, rng) { return a[Math.floor(rng() * a.length)]; }
  function lineOk(cells) { return LINES.every(function (l) { return l.filter(function (i) { return cells[i] && cells[i].tier === 3; }).length <= 2; }); }

  /** Finds a library team entry by key or abbreviation. */
  function libTeam(lib, team) {
    if (!lib || !lib.teams || !team) return null;
    if (team.key && lib.teams[team.key]) return lib.teams[team.key];
    var abbr = (team.abbr || '').toUpperCase(), name = (team.name || '').toLowerCase(), k, t;
    for (k in lib.teams) {
      if (!lib.teams.hasOwnProperty(k)) continue;
      t = lib.teams[k];
      if (abbr && ((t.abbr || '').toUpperCase() === abbr || (t.aliases || []).indexOf(abbr) !== -1)) return t;
    }
    // Fall back to the nickname, which is unique within MLB, NFL, NBA and NHL.
    for (k in lib.teams) if (lib.teams.hasOwnProperty(k) && name && (lib.teams[k].name || '').toLowerCase() === name) return lib.teams[k];
    return null;
  }

  /**
   * game: { home, away: {name, city, abbr, key?}, venue: {name, city, roof?}, story: [{text, tier, side}] }
   * research: [{text, tier, category, team}] written by the AI, or null.
   */
  function buildPool(game, lib, research) {
    var out = [], seen = {};
    function add(text, tier, cat, side, src) {
      var t = String(text || '').trim();
      var k = t.toLowerCase();
      if (!t || seen[k] || [1, 2, 3].indexOf(tier) === -1) return;
      seen[k] = 1;
      out.push({ id: cat + ':' + (side || '') + ':' + t, text: t, tier: tier, cat: cat, side: side || null, src: src || 'library' });
    }
    // Researched squares go in first so they win any duplicate.
    (research || []).forEach(function (s) {
      var cat = s.category === 'venue' ? 'venue' : s.category === 'storyline' ? 'story' : 'team';
      add(s.text, s.tier, cat, s.team === 'home' || s.team === 'away' ? s.team : null, 'ai');
    });
    (game.story || []).forEach(function (s) { add(s.text, s.tier, s.cat || 'story', s.side, 'curated'); });
    ['away', 'home'].forEach(function (side) {
      var team = game[side];
      (lib.teamTemplates || []).forEach(function (s) { add(s[0].replace('{team}', team.name), s[1], 'team', side); });
      var entry = libTeam(lib, team);
      if (entry) {
        (entry.squares || []).forEach(function (s) { add(s[0], s[1], 'team', side, 'curated'); });
        if (side === 'home') (entry.homeSquares || []).forEach(function (s) { add(s[0], s[1], 'venue', null, 'curated'); });
      }
    });
    var roof = game.venue && game.venue.roof;
    if (roof && lib.roofSquares && lib.roofSquares[roof]) lib.roofSquares[roof].forEach(function (s) { add(s[0], s[1], 'venue', null); });
    (lib.generic || []).forEach(function (s) { add(s[0], s[1], 'generic', null); });
    return out;
  }

  function place(picks, rng, free) {
    var cells;
    for (var t = 0; t < 400; t++) {
      var p = shuffle(picks.slice(), rng), k = 0;
      cells = [];
      for (var i = 0; i < 25; i++) cells.push(free && i === 12 ? { free: true } : p[k++]);
      if (lineOk(cells)) return cells;
    }
    return cells;
  }

  function makeCard(rng, pool, prev, opts) {
    var d = DIFF[opts.diff] || DIFF.standard, N = opts.free ? 24 : 25;
    var gen = pool.filter(function (q) { return q.cat === 'generic'; });
    var homeL = pool.filter(function (q) { return q.cat === 'team' && q.side === 'home'; });
    var awayL = pool.filter(function (q) { return q.cat === 'team' && q.side === 'away'; });
    var neuL = pool.filter(function (q) { return q.cat === 'venue' || q.cat === 'story'; });
    var specL = pool.filter(function (q) { return q.cat !== 'generic'; });
    // Researched squares are the point of a researched game, so favor them.
    var aiShare = pool.some(function (q) { return q.src === 'ai'; }) ? 0.75 : 0;
    var best = null;
    for (var attempt = 0; attempt < 80; attempt++) {
      var used = {}, picks = [];
      var take = function (q) { used[q.id] = 1; picks.push(q); };
      var free = function (q) { return !used[q.id]; };
      var tierPick = function () { var r = rng(); return r < d.w[1] ? 1 : (r < d.w[1] + d.w[2] ? 2 : 3); };
      var draw = function (list, k) {
        for (var j = 0; j < k; j++) {
          var t = tierPick();
          var base = list.filter(free);
          if (aiShare && rng() < aiShare) { var ai = base.filter(function (q) { return q.src === 'ai'; }); if (ai.length) base = ai; }
          var c = base.filter(function (q) { return q.tier === t; });
          if (!c.length) c = base;
          if (!c.length) return;
          take(pickOne(c, rng));
        }
      };
      var S = MIN_SPECIFIC + Math.floor(rng() * (aiShare ? 6 : 4));
      var neutral = Math.round(S * 0.3), half = S - neutral;
      var homeN = Math.floor(half / 2), awayN = half - homeN;
      if (rng() < .5) { var sw = homeN; homeN = awayN; awayN = sw; }
      draw(homeL, homeN); draw(awayL, awayN); draw(neuL, neutral);
      while (picks.length < MIN_SPECIFIC) { var c0 = specL.filter(free); if (!c0.length) break; take(pickOne(c0, rng)); }

      var target = { 1: Math.round(N * d.t1f), 3: d.t3 }; target[2] = N - target[1] - target[3];
      var u = { 1: 0, 2: 0, 3: 0 }; picks.forEach(function (q) { u[q.tier]++; });
      var rem = { 1: Math.max(0, target[1] - u[1]), 2: Math.max(0, target[2] - u[2]), 3: Math.max(0, target[3] - u[3]) };
      var need = N - picks.length, sum = rem[1] + rem[2] + rem[3];
      while (sum > need) { if (rem[2] > 0) rem[2]--; else if (rem[1] > 0) rem[1]--; else rem[3]--; sum--; }
      while (sum < need) { rem[2]++; sum++; }
      [3, 1, 2].forEach(function (t) {
        for (var j = 0; j < rem[t]; j++) {
          var c = gen.filter(function (q) { return free(q) && q.tier === t; });
          if (!c.length) c = gen.filter(function (q) { return free(q) && q.tier === 2; });
          if (!c.length) c = gen.filter(free);
          if (!c.length) c = specL.filter(free);
          if (!c.length) break;
          take(pickOne(c, rng));
        }
      });
      if (picks.length < N) continue;
      var cells = place(picks, rng, opts.free);
      var ids = {}; picks.forEach(function (q) { ids[q.id] = 1; });
      var tooClose = prev.some(function (p) {
        var n = 0; p.cells.forEach(function (c) { if (c && !c.free && ids[c.id]) n++; });
        return n > 0.6 * N;
      });
      best = { cells: cells };
      if (!tooClose && lineOk(cells)) return best;
    }
    return best;
  }

  function makeCards(pool, opts) {
    var rng = mulberry32((opts.seed ^ hashStr(opts.salt || '')) >>> 0);
    var cards = [];
    for (var i = 0; i < opts.count; i++) cards.push(makeCard(rng, pool, cards, opts));
    return cards;
  }

  /** Returns a replacement square for one cell, or null if nothing fits. */
  function swapCandidate(card, pos, pool) {
    var cur = card.cells[pos];
    if (!cur || cur.free) return null;
    var inCard = {}; card.cells.forEach(function (c) { if (!c.free) inCard[c.id] = 1; });
    var rest = pool.filter(function (q) { return !inCard[q.id]; });
    var same = function (q) { return q.cat === cur.cat && (cur.cat !== 'team' || q.side === cur.side); };
    var c = rest.filter(function (q) { return same(q) && q.tier === cur.tier; });
    if (!c.length) c = rest.filter(same);
    if (!c.length) c = rest.filter(function (q) { return (cur.cat === 'generic' || q.cat !== 'generic') && q.tier === cur.tier; });
    c = c.filter(function (q) { var test = card.cells.slice(); test[pos] = q; return lineOk(test); });
    return c.length ? pickOne(c, Math.random) : null;
  }

  function specificCount(card) { return card.cells.filter(function (c) { return !c.free && c.cat !== 'generic'; }).length; }
  function aiCount(card) { return card.cells.filter(function (c) { return !c.free && c.src === 'ai'; }).length; }
  function longCount(card) { return card.cells.filter(function (c) { return !c.free && c.tier === 3; }).length; }

  window.Bingo = window.Bingo || {};
  window.Bingo.engine = {
    CATS: CATS, TIERS: TIERS, DIFF: DIFF, MIN_SPECIFIC: MIN_SPECIFIC,
    buildPool: buildPool, makeCards: makeCards, swapCandidate: swapCandidate, libTeam: libTeam,
    specificCount: specificCount, aiCount: aiCount, longCount: longCount, lineOk: lineOk, hashStr: hashStr
  };
})();
