# Game Day Bingo

Free printable bingo cards written for one specific game. Every card has at least 9 of its 25 squares about that game's teams, players, ballpark or storylines. The rest are plays that can happen in any game.

The whole site is one file, `index.html`. It runs entirely in the browser and needs no server or database. PDFs are built on the visitor's device with [jsPDF](https://github.com/parallax/jsPDF).

## Publish it with GitHub Pages

1. Create a new public repository on GitHub, for example `game-day-bingo`.
2. Upload `index.html` and this `README.md` to the repository: **Add file → Upload files**, then **Commit changes**.
3. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick the `main` branch and the `/ (root)` folder, then select **Save**.
4. After a minute or two the site is live at `https://<your-username>.github.io/game-day-bingo/`.

To use your own domain, enter it under **Settings → Pages → Custom domain**, then add the DNS record your domain registrar asks for.

## Adding a game

The square library is near the top of the script in `index.html`:

- `GENERIC`: plays that can happen in any game.
- `TEAMS`: squares for each team and its players.
- `VENUES`: squares for each ballpark and its broadcast.
- `GAMES`: one entry per game, with the date, time, teams, venue, probable starters and storyline squares.

Each square has a tier: `1` is likely (over 70%), `2` is a toss-up (30–70%) and `3` is a long shot (under 30%). To add a game, copy an entry in `GAMES` and change its details. Team, player and storyline squares go out of date quickly, so check them before each game.

## Card rules

- At least 9 of the 25 squares are about the specific game, split between the two teams.
- The difficulty setting controls the mix of likely, toss-up and long-shot squares.
- No row, column or diagonal has more than two long shots.
- No two cards in a set share more than 60% of their squares.

## Not affiliated

This is a fan project. It is not affiliated with Major League Baseball or any team. Team and player names are used only to describe the games. Do not add league or team logos.
