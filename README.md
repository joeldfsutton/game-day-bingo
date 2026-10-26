# Game Day Bingo

Printable bingo cards written for one specific game. Visitors pick a game from the next 36 hours. Signed-in visitors get squares that Claude has researched for that game's players, venue and storylines, then download a PDF with one unique card per page and a host checklist.

Every card has at least 9 of its 25 squares about that game. When research isn't available, squares built from the team names and each stadium's traditions still meet that rule.

## How it works

```
GitHub Pages (index.html, js/, data/)
   │  reads the schedule, signs people in
   ▼
Supabase ── events table: schedule + researched squares, readable by everyone
   ├── sync-events (hourly): pulls NFL, NBA and NHL games from BALLDONTLIE
   └── generate-squares (on first pick): asks Claude to research the game with
       web search, checks the JSON it returns, and saves it for everyone
```

- **Research once, share with everyone.** The first signed-in visitor to pick a game triggers research, which usually takes under a minute. Everyone after that gets the saved squares instantly. Squares written more than 3 hours before a game are refreshed once inside that window, so confirmed lineups and late scratches are picked up.
- **Checked before use.** The server drops squares that are too long, mention injuries or betting, or lack a team, and rejects a result that has fewer than 14 usable squares. A failed or rate-limited research run falls back to standard squares.
- **Sources shown.** The pages Claude cited are listed under the card and on the host checklist.
- **Spending limits.** Research is capped per user per hour and across the whole site per day. See `SETUP.md`.

## Demo mode

Until `js/config.js` has a Supabase URL and key, the site runs without a backend. It shows the hand-written featured games in `data/games.json` with standard squares, and anyone can print. To turn on the live version, follow **[SETUP.md](SETUP.md)**.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The page and its styles |
| `js/app.js` | Game list, sign-in, research requests, card preview |
| `js/engine.js` | Builds each game's square pool and deals balanced, unique cards |
| `js/pdf.js` | Draws the cards and host checklist with jsPDF |
| `js/config.js` | Supabase URL and public anon key (empty = demo mode) |
| `data/nfl.json`, `nba.json`, `nhl.json`, `mlb.json` | Per-sport squares: plays for any game, team-name templates, stadium traditions |
| `data/games.json` | Hand-written featured games, such as the World Series |
| `supabase/migrations/` | Database tables and access rules |
| `supabase/functions/` | The two server functions and their shared logic |
| `tests/` | Tests for the server logic. Run `npm test` |

## Card rules

- At least 9 of the 25 squares are about the specific game, split between the two teams.
- When a game has been researched, most of those come from the research.
- The difficulty setting controls the mix of likely (over 70%), toss-up (30–70%) and long-shot (under 30%) squares.
- No row, column or diagonal has more than two long shots.
- No two cards in a set share more than 60% of their squares.

## Adding a featured game

Copy an entry in `data/games.json` and change its details. `away`, `home` and `venue` are keys from the sport's file in `data/`. In `story`, each square is `[text, tier, team key]`, and the team key can be left out.

## Not affiliated

This is a fan project. It is not affiliated with any league or team. Team and player names are used only to describe the games. Don't add league or team logos.
