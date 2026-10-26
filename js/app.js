// Game Day Bingo app: loads games, handles sign-in, asks the backend to research a
// game, and turns the squares into printable cards.
(function () {
  'use strict';

  var E = window.Bingo.engine;
  var CFG = window.BINGO_CONFIG || {};
  var WINDOW_AHEAD_H = 36, WINDOW_BEHIND_H = 3;
  var SPORT_ORDER = ['nfl', 'nba', 'nhl', 'mlb'];
  var REFRESH_WINDOW_MS = 3 * 3600 * 1000;
  var EVENT_COLUMNS = 'id,sport,starts_at,status_state,home_name,home_city,home_abbr,home_full,away_name,away_city,away_abbr,away_full,venue_name,venue_city,week,postseason,squares_status,squares,facts,sources,generated_at,refresh_count';

  var st = {
    libs: {}, games: [], gameId: null, filter: 'all',
    count: 8, diff: 'standard', free: true, title: '', paper: 'letter', perPage: 1, ink: false, checklist: true,
    seed: 2410, idx: 0, cards: [], pool: [],
    client: null, session: null, live: false, research: {}
  };

  // ---------- Small helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setStatus(msg, kind) { var s = $('status'); s.textContent = msg; s.className = 'status' + (kind ? ' ' + kind : ''); }
  function fmtDate(d) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function fmtTime(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }
  function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function dayLabel(d) {
    var now = new Date(), tom = new Date(now.getTime() + 86400000);
    if (dayKey(d) === dayKey(now)) return 'Today';
    if (dayKey(d) === dayKey(tom)) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function signedIn() { return !!(st.session && st.session.user); }
  function canMakeCards() { return !st.live || signedIn(); }
  function game() { return st.games.filter(function (g) { return g.id === st.gameId; })[0] || null; }
  function lib(g) { return st.libs[g.sport]; }
  function matchup(g) { return g.away.name + ' at ' + g.home.name; }

  // ---------- Loading ----------
  function loadJson(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  function featuredToGame(f) {
    var L = st.libs[f.sport]; if (!L) return null;
    var h = L.teams[f.home] || {}, a = L.teams[f.away] || {}, v = (L.venues || {})[f.venue] || {};
    var side = function (key) { return key === f.home ? 'home' : key === f.away ? 'away' : null; };
    return {
      id: f.id, sport: f.sport, kind: 'featured', title: f.title, short: f.short, cardTitle: f.cardTitle,
      startsAt: new Date(f.startsAt),
      home: { key: f.home, name: h.name, city: h.city, abbr: h.abbr },
      away: { key: f.away, name: a.name, city: a.city, abbr: a.abbr },
      venue: { name: v.name, city: v.city, roof: v.roof },
      facts: f.facts || [],
      story: (f.story || []).map(function (s) { return { text: s[0], tier: s[1], side: side(s[2]) }; }),
      row: null
    };
  }

  function rowToGame(r) {
    var L = st.libs[r.sport]; if (!L) return null;
    var home = { name: r.home_name, city: r.home_city, abbr: r.home_abbr, full: r.home_full };
    var away = { name: r.away_name, city: r.away_city, abbr: r.away_abbr, full: r.away_full };
    var entry = E.libTeam(L, home), libVenue = entry && L.venues ? L.venues[entry.venue] : null;
    var short = L.label + (r.week ? ' Week ' + r.week : '') + (r.postseason ? ' Playoffs' : '');
    return {
      id: r.id, sport: r.sport, kind: 'feed', title: short + ': ' + away.name + ' at ' + home.name, short: short,
      cardTitle: L.bingoTitle, startsAt: new Date(r.starts_at), home: home, away: away,
      venue: { name: r.venue_name || (libVenue && libVenue.name) || null, city: r.venue_city || (libVenue && libVenue.city) || null, roof: libVenue ? libVenue.roof : null },
      facts: [], story: [], row: r
    };
  }

  function inWindow(g) {
    var t = g.startsAt.getTime(), now = Date.now();
    return t >= now - WINDOW_BEHIND_H * 3600000 && t <= now + WINDOW_AHEAD_H * 3600000;
  }

  function loadEvents() {
    if (!st.client) return Promise.resolve([]);
    var from = new Date(Date.now() - WINDOW_BEHIND_H * 3600000).toISOString();
    var to = new Date(Date.now() + WINDOW_AHEAD_H * 3600000).toISOString();
    return st.client.from('events').select(EVENT_COLUMNS).gte('starts_at', from).lte('starts_at', to).order('starts_at')
      .then(function (res) {
        if (res.error) throw res.error;
        return (res.data || []).map(rowToGame).filter(Boolean);
      });
  }

  function init() {
    if (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient) {
      st.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
      st.live = true;
    }
    var libsP = Promise.all(['mlb', 'nfl', 'nba', 'nhl'].map(function (s) {
      return loadJson('data/' + s + '.json').then(function (j) { st.libs[s] = j; });
    }));
    var sessionP = st.client ? st.client.auth.getSession().then(function (r) { st.session = r.data.session; }) : Promise.resolve();
    Promise.all([libsP, sessionP]).then(function () {
      return Promise.all([
        loadJson('data/games.json').then(function (j) { return (j.games || []).map(featuredToGame).filter(Boolean); }),
        loadEvents().catch(function (e) { showBanner('Couldn’t load the live schedule (' + (e.message || e) + '). Showing featured games only.'); return []; })
      ]);
    }).then(function (lists) {
      st.games = lists[0].concat(lists[1]).filter(inWindow).sort(function (a, b) { return a.startsAt - b.startsAt; });
      var next = st.games.filter(function (g) { return g.startsAt.getTime() > Date.now(); })[0] || st.games[0];
      st.gameId = next ? next.id : null;
      if (!st.live) showBanner('Demo mode: showing featured games with standard squares. Live schedules and researched squares turn on once the backend is set up.');
      renderAccount(); renderFilters(); renderGames(); selectGame(st.gameId);
    }).catch(function (e) {
      $('games').innerHTML = '<p class="empty">Couldn’t load the square library: ' + esc(e.message || e) + '. Reload the page to try again.</p>';
    });
    if (st.client) {
      st.client.auth.onAuthStateChange(function (_event, session) {
        var was = signedIn();
        st.session = session;
        if (was !== signedIn()) { renderAccount(); if (st.gameId) selectGame(st.gameId); }
      });
    }
  }

  function showBanner(msg) { var b = $('banner'); b.textContent = msg; b.hidden = false; }

  // ---------- Account ----------
  function renderAccount() {
    var el = $('account');
    if (!st.live) { el.innerHTML = ''; return; }
    if (signedIn()) {
      el.innerHTML = '<span class="who">' + esc(st.session.user.email || 'Signed in') + '</span><button class="btn small" type="button" id="signout">Sign out</button>';
      $('signout').addEventListener('click', function () { st.client.auth.signOut(); });
    } else {
      el.innerHTML = '<button class="btn small primary" type="button" id="signin-open">Sign in</button>';
      $('signin-open').addEventListener('click', openSignIn);
    }
  }

  function openSignIn() {
    $('signin-status').textContent = ''; $('signin-status').className = 'status';
    $('signin-field').hidden = false; $('signin-send').hidden = false;
    $('signin-msg').textContent = 'We’ll email you a link. Open it on this device to sign in. No password needed.';
    var d = $('signin');
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    setTimeout(function () { $('email').focus(); }, 30);
  }
  function closeSignIn() { var d = $('signin'); if (d.open) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); } }

  $('signin-cancel').addEventListener('click', closeSignIn);
  $('signin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('email').value.trim();
    if (!email) return;
    $('signin-send').disabled = true;
    $('signin-status').textContent = 'Sending…';
    st.client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (res) {
      $('signin-send').disabled = false;
      if (res.error) { $('signin-status').textContent = 'Couldn’t send the link: ' + res.error.message; $('signin-status').className = 'status err'; return; }
      $('signin-msg').textContent = 'Check ' + email + ' for a sign-in link. You can close this window.';
      $('signin-field').hidden = true; $('signin-send').hidden = true; $('signin-status').textContent = '';
    });
  });

  // ---------- Game list ----------
  function renderFilters() {
    var sports = SPORT_ORDER.filter(function (s) { return st.games.some(function (g) { return g.sport === s; }); });
    var opts = [['all', 'All']].concat(sports.map(function (s) { return [s, st.libs[s].label]; }));
    $('filters').innerHTML = sports.length > 1 ? opts.map(function (o) {
      return '<button type="button" class="chipbtn" data-f="' + o[0] + '" aria-pressed="' + (st.filter === o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') : '';
  }

  function renderGames() {
    var list = st.games.filter(function (g) { return st.filter === 'all' || g.sport === st.filter; });
    if (!list.length) { $('games').innerHTML = '<p class="empty">No games in the next 36 hours. Check back later.</p>'; return; }
    var html = '', lastDay = '';
    list.forEach(function (g) {
      var d = dayLabel(g.startsAt);
      if (d !== lastDay) { html += '<div class="day">' + esc(d) + '</div>'; lastDay = d; }
      var started = g.startsAt.getTime() <= Date.now();
      var tag = g.kind === 'featured' ? '<span class="tag feat">Featured</span>'
        : (g.row && g.row.squares_status === 'ready' ? '<span class="tag ready">Researched</span>' : '');
      html += '<label class="game-opt"><input type="radio" name="game" value="' + esc(g.id) + '"' + (g.id === st.gameId ? ' checked' : '') + '>' +
        '<strong>' + esc(matchup(g)) + '</strong>' +
        '<span class="meta"><span class="tag">' + esc(st.libs[g.sport].label) + '</span>' + esc(fmtTime(g.startsAt)) +
        (started ? ' <span class="tag live">Started</span>' : '') + tag + '</span></label>';
    });
    $('games').innerHTML = html;
  }

  $('filters').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]'); if (!b) return;
    st.filter = b.getAttribute('data-f'); renderFilters(); renderGames();
  });
  $('games').addEventListener('change', function (e) {
    if (e.target.name === 'game') { st.idx = 0; selectGame(e.target.value); setStatus('', ''); }
  });

  // ---------- Research ----------
  function researchSquares(g) {
    if (!g || g.kind !== 'feed' || !g.row || g.row.squares_status !== 'ready' || !signedIn()) return null;
    return Array.isArray(g.row.squares) ? g.row.squares : null;
  }

  function clientNeedsRefresh(r) {
    if (r.squares_status !== 'ready' || !r.generated_at) return false;
    var start = Date.parse(r.starts_at), now = Date.now(), gen = Date.parse(r.generated_at);
    return start - now <= REFRESH_WINDOW_MS && start > now && gen < start - REFRESH_WINDOW_MS && (r.refresh_count || 0) < 1;
  }

  function maybeResearch(g) {
    if (!st.live || !signedIn() || !g || g.kind !== 'feed') return;
    var r = g.row, state = st.research[g.id];
    if (state && state.status === 'loading') return;
    if (r.squares_status === 'ready' && !clientNeedsRefresh(r)) return;
    requestResearch(g, r.squares_status === 'ready');
  }

  function requestResearch(g, quiet) {
    var state = st.research[g.id] = { status: 'loading', quiet: quiet, startedAt: Date.now() };
    renderResearch();
    var ticker = setInterval(function () { if (st.gameId === g.id && state.status === 'loading') renderResearch(); else clearInterval(ticker); }, 1000);
    st.client.functions.invoke('generate-squares', { body: { event_id: g.id } }).then(function (res) {
      if (res.error) {
        var ctx = res.error.context;
        if (ctx && typeof ctx.json === 'function') return ctx.json().then(handle, function () { handle({ status: 'failed', error: res.error.message }); });
        // A network timeout here doesn't mean research failed; it may still be running.
        return handle({ status: 'pending' });
      }
      handle(res.data);
    });

    function handle(body) {
      body = body || {};
      if (body.event) applyRow(body.event);
      if (body.status === 'ready') { state.status = 'ready'; finish(); }
      else if (body.status === 'pending') poll();
      else { state.status = body.status === 'limited' ? 'limited' : 'failed'; state.message = body.error || 'Research didn’t finish.'; finish(); }
    }
    function poll() {
      if (Date.now() - state.startedAt > 4 * 60000) { state.status = 'failed'; state.message = 'Research is taking too long. Cards use standard squares for now.'; finish(); return; }
      setTimeout(function () {
        st.client.from('events').select(EVENT_COLUMNS).eq('id', g.id).maybeSingle().then(function (res) {
          if (res.data) applyRow(res.data);
          var s = res.data && res.data.squares_status;
          if (s === 'ready') { state.status = 'ready'; finish(); }
          else if (s === 'failed') { state.status = 'failed'; state.message = 'Research didn’t finish. Cards use standard squares for this game.'; finish(); }
          else poll();
        });
      }, 5000);
    }
    function finish() {
      clearInterval(ticker);
      renderGames();
      if (st.gameId === g.id) { rebuild(); renderResearch(); }
    }
  }

  function applyRow(row) {
    st.games.forEach(function (g, i) { if (g.id === row.id) { var n = rowToGame(row); if (n) st.games[i] = n; } });
  }

  function renderResearch() {
    var el = $('research'), g = game();
    if (!g) { el.hidden = true; return; }
    var state = st.research[g.id];
    if (st.live && !signedIn() && g.kind === 'feed') {
      el.hidden = false;
      el.innerHTML = '<div><p class="title">This is a sample card with standard squares.</p><p class="sub"><button type="button" class="linkbtn" id="research-signin">Sign in</button> to get squares researched for this game’s players, venue and storylines, and to print cards.</p></div>';
      $('research-signin').addEventListener('click', openSignIn);
      return;
    }
    if (state && state.status === 'loading' && !state.quiet) {
      var secs = Math.round((Date.now() - state.startedAt) / 1000);
      el.hidden = false;
      el.innerHTML = '<span class="spinner" aria-hidden="true"></span><div><p class="title">Researching ' + esc(matchup(g)) + '…</p><p class="sub">Checking lineups, injuries and storylines. This usually takes under a minute (' + secs + 's so far). The card below uses standard squares until it’s done.</p></div>';
      return;
    }
    if (state && (state.status === 'failed' || state.status === 'limited')) {
      el.hidden = false;
      el.innerHTML = '<div><p class="title">' + esc(state.message) + '</p><p class="sub">Every card still has at least 9 squares about these teams.' + (state.status === 'failed' ? ' <button type="button" class="linkbtn" id="research-retry">Try again</button>' : '') + '</p></div>';
      var rb = $('research-retry'); if (rb) rb.addEventListener('click', function () { requestResearch(g, false); });
      return;
    }
    el.hidden = true;
  }

  function renderSources() {
    var el = $('sources'), g = game(), sq = researchSquares(g);
    var src = sq && g.row.sources;
    if (!src || !src.length) { el.hidden = true; el.innerHTML = ''; return; }
    var when = g.row.generated_at ? new Date(g.row.generated_at) : null;
    el.hidden = false;
    el.innerHTML = 'Squares researched by Claude' + (when ? ' at ' + esc(fmtTime(when)) + ' on ' + esc(fmtDate(when)) : '') + ' from:<ul>' +
      src.slice(0, 8).map(function (s) {
        var ok = /^https?:\/\//.test(s.url);
        return '<li>' + (ok ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(s.title || s.url) + '</a>' : esc(s.title)) + '</li>';
      }).join('') + '</ul>';
  }

  // ---------- Cards ----------
  function selectGame(id) {
    st.gameId = id;
    var g = game();
    if (!g) { $('matchup').innerHTML = ''; $('card').innerHTML = ''; return; }
    rebuild();
    renderResearch();
    maybeResearch(g);
  }

  function rebuild() {
    var g = game(); if (!g) return;
    var research = researchSquares(g);
    st.pool = E.buildPool(g, lib(g), research);
    st.cards = E.makeCards(st.pool, {
      count: st.count, diff: st.diff, free: st.free, seed: st.seed,
      salt: g.id + st.diff + st.free + (research ? g.row.generated_at : '')
    });
    st.idx = Math.min(st.idx, st.count - 1);
    renderMatchup(); renderCard(-1); renderSources(); renderActions();
    $('diff-hint').textContent = E.DIFF[st.diff].hint;
  }

  function titles(g) {
    var custom = st.title.trim();
    var parts = [g.away.city + ' at ' + g.home.city, fmtDate(g.startsAt), fmtTime(g.startsAt)];
    if (g.venue && g.venue.name) parts.push(g.venue.name);
    return {
      eyebrow: parts.join(' · ').toUpperCase(),
      title: custom || g.cardTitle || lib(g).bingoTitle,
      sub: (custom ? (g.kind === 'featured' ? g.title : g.short) : g.short) + ' · ' + matchup(g)
    };
  }

  function renderMatchup() {
    var g = game();
    var facts = g.facts.slice();
    var r = researchSquares(g) && g.row.facts;
    if (r) r.forEach(function (f) { facts.push([f.label, f.value]); });
    $('matchup').innerHTML =
      '<div class="eyebrow">' + esc(g.kind === 'featured' ? g.title : g.short) + '</div>' +
      '<h2>' + esc((g.away.city ? g.away.city + ' ' : '') + g.away.name + ' at ' + (g.home.city ? g.home.city + ' ' : '') + g.home.name) + '</h2>' +
      '<span class="fact"><b>When</b>' + esc(fmtDate(g.startsAt) + ', ' + fmtTime(g.startsAt)) + '</span>' +
      (g.venue && g.venue.name ? '<span class="fact"><b>Where</b>' + esc(g.venue.name + (g.venue.city ? ', ' + g.venue.city : '')) + '</span>' : '') +
      facts.map(function (f) { return '<span class="fact"><b>' + esc(f[0]) + '</b>' + esc(f[1]) + '</span>'; }).join('');
  }

  function renderCard(flashPos) {
    var g = game(), card = st.cards[st.idx], t = titles(g), L = lib(g);
    var cells = card.cells.map(function (c, i) {
      if (c.free) return '<div class="sq free"><b>Free</b><small>' + esc(L.freeLabel) + '</small></div>';
      return '<button type="button" class="sq cat-' + c.cat + ' t' + c.tier + (c.src === 'ai' ? ' ai' : '') + (i === flashPos ? ' swapped' : '') + '" data-pos="' + i + '" title="' + esc(E.CATS[c.cat] + ' · ' + E.TIERS[c.tier] + (c.src === 'ai' ? ' · researched' : '') + ' · click to swap') + '" aria-label="' + esc(c.text + '. ' + E.CATS[c.cat] + ', ' + E.TIERS[c.tier] + '. Swap this square') + '">' + esc(c.text) + '</button>';
    }).join('');
    $('card').innerHTML =
      '<div class="bc-head"><div class="bc-l"><div class="bc-eyebrow">' + esc(t.eyebrow) + '</div>' +
      '<div class="bc-title">' + esc(t.title) + '</div><div class="bc-sub">' + esc(t.sub) + '</div></div>' +
      '<div class="bc-r"><div class="bc-no">Card ' + (st.idx + 1) + '</div><div class="bc-name">Name: ____________________</div></div></div>' +
      '<div class="bc-letters" aria-hidden="true"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span></div>' +
      '<div class="bc-grid">' + cells + '</div>' +
      '<p class="bc-foot"><strong>How to play:</strong> Mark a square when it happens during the game. Five in a row across, down or diagonal wins.' + (st.free ? ' The center is free.' : '') + '</p>';
    $('sample').hidden = canMakeCards();
    $('pos').textContent = 'Card ' + (st.idx + 1) + ' of ' + st.cards.length;
    $('prev').disabled = st.idx === 0;
    $('next').disabled = st.idx >= st.cards.length - 1;
    var spec = E.specificCount(card), ai = E.aiCount(card);
    var minSpec = Math.min.apply(null, st.cards.map(E.specificCount));
    $('stats').innerHTML =
      '<span class="pill good">' + spec + ' of 25 squares about this game</span>' +
      (ai ? '<span class="pill">' + ai + ' researched</span>' : '') +
      '<span class="pill">' + E.longCount(card) + ' long shots</span>' +
      '<span class="pill">Every card: ' + minSpec + '+ game squares</span>';
  }

  function renderActions() {
    var ok = canMakeCards();
    $('download').textContent = ok ? 'Download PDF' : 'Sign in to make cards';
    $('print').hidden = !ok;
  }

  function swap(pos) {
    var card = st.cards[st.idx], cur = card.cells[pos];
    var next = E.swapCandidate(card, pos, st.pool);
    if (!next) { setStatus('No other square fits in that spot.', ''); return; }
    card.cells[pos] = next;
    renderCard(pos);
    setStatus('Swapped “' + cur.text + '” for “' + next.text + '”.', '');
  }

  // ---------- PDF ----------
  function makePdfBlob() {
    if (!window.jspdf || !window.jspdf.jsPDF) { setStatus('The PDF tool didn’t load. Check your connection and reload the page.', 'err'); return null; }
    var g = game(); if (!g) return null;
    setStatus('Building ' + st.cards.length + ' cards…', '');
    try {
      var buf = window.Bingo.pdf.build({
        cards: st.cards, titles: titles(g), gameLine: (g.kind === 'featured' ? g.title : g.short) + ' | ' + matchup(g) + ' | ' + fmtDate(g.startsAt),
        free: st.free, freeLabel: lib(g).freeLabel, paper: st.paper, perPage: st.perPage, ink: st.ink,
        checklist: st.checklist, seed: st.seed, sources: researchSquares(g) ? (g.row.sources || []) : []
      });
      return new Blob([buf], { type: 'application/pdf' });
    } catch (e) { setStatus('Couldn’t build the PDF: ' + e.message, 'err'); return null; }
  }

  function pdfName() {
    var g = game();
    return (matchup(g) + ' bingo ' + st.cards.length + ' cards').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
  }

  function download() {
    if (!canMakeCards()) { openSignIn(); return; }
    var blob = makePdfBlob(); if (!blob) return;
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = pdfName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    setStatus('PDF downloaded. Open it and print, or send it to your guests.', 'ok');
  }

  function openToPrint() {
    if (!canMakeCards()) { openSignIn(); return; }
    var tab = window.open('', '_blank');
    var blob = makePdfBlob();
    if (!blob) { if (tab) tab.close(); return; }
    var url = URL.createObjectURL(blob);
    if (tab) { tab.location.href = url; setStatus('The PDF opened in a new tab. Use your browser’s Print button there.', 'ok'); }
    else setStatus('Your browser blocked the new tab. Use Download PDF instead.', 'err');
  }

  // ---------- Controls ----------
  function readCount() { var n = parseInt($('count').value, 10); if (isNaN(n)) n = 8; return Math.max(1, Math.min(100, n)); }
  $('count').addEventListener('change', function () { st.count = readCount(); $('count').value = st.count; rebuild(); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="diff"]'), function (r) {
    r.addEventListener('change', function () { st.diff = r.value; rebuild(); });
  });
  $('free').addEventListener('change', function () { st.free = $('free').checked; rebuild(); });
  $('title').addEventListener('input', function () { st.title = $('title').value; if (game()) renderCard(-1); });
  $('paper').addEventListener('change', function () { st.paper = $('paper').value; });
  $('perpage').addEventListener('change', function () { st.perPage = parseInt($('perpage').value, 10); });
  $('ink').addEventListener('change', function () { st.ink = $('ink').checked; });
  $('checklist').addEventListener('change', function () { st.checklist = $('checklist').checked; });
  $('showtypes').addEventListener('change', function () { $('card').classList.toggle('types', $('showtypes').checked); });
  $('reshuffle').addEventListener('click', function () { st.seed = 1000 + Math.floor(Math.random() * 9000); st.idx = 0; rebuild(); setStatus('Dealt a new set of ' + st.count + ' cards.', ''); });
  $('prev').addEventListener('click', function () { if (st.idx > 0) { st.idx--; renderCard(-1); } });
  $('next').addEventListener('click', function () { if (st.idx < st.cards.length - 1) { st.idx++; renderCard(-1); } });
  $('card').addEventListener('click', function (e) { var b = e.target.closest('button.sq'); if (b) swap(parseInt(b.getAttribute('data-pos'), 10)); });
  $('download').addEventListener('click', download);
  $('print').addEventListener('click', openToPrint);
  $('controls').addEventListener('submit', function (e) { e.preventDefault(); });

  init();
})();
