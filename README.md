# APEX / French Racing

This folder contains the standalone local browser prototype for APEX, a French-learning racing game. It is a single-lap game: solo mode has one human driver and three seeded rivals; local mode supports two to four human drivers on one screen; classroom mode lets a teacher host up to 16 learners from their own devices. It makes no official Formula Dé rules claim.

## Run

Install Node.js (current LTS), then double-click `launch.cmd` to start the server and open the default browser, or run:

```powershell
cd french-racing
npm start
```

The server binds to `127.0.0.1` on port `4178` by default. Open `http://127.0.0.1:4178/` in a browser. Override the port for a second local copy with `$env:PORT=4179; npm start`.

## Classroom multiplayer

The teacher's browser is the race server; learner devices just open a link. No database tables or security policies to configure: rooms sync over Supabase Realtime Broadcast.

One-time setup (2 minutes):

1. Create a free project at supabase.com, then open Project Settings → API.
2. Copy `supabase-config.example.js` to `supabase-config.js` and paste the project URL and anon public key. Every device on the same address inherits it, so guests never type keys. (You can also paste the keys on the host screen instead; that covers the teacher browser only.) The file stays on your machine — git ignores it.
3. Start the server on the classroom network with `node serve.mjs --host 0.0.0.0`, then open the host page through your laptop's Wi-Fi address, e.g. `http://192.168.1.5:4178/#/host`.

Race day: pick a circuit and sentence set, show the lobby QR code on the whiteboard, and learners scan it — or type the room code plus the 4-digit password — then enter their names. Every round all drivers lock a gear and answer at the same time on their devices; the whiteboard shows the circuit, the cars, live positions, and who has answered. Silent drivers coast when the 75-second clock runs out. Imported sentence sets deal to every device automatically. The race ends with a podium and fireworks on all screens.

## One-click start (no terminal)

- **Mac:** double-click `launch.command`. The first time, right-click it and choose Open (Apple asks once for downloaded files). It starts the server and opens the game; press Enter in the window to stop.
- **Windows:** double-click `launch.cmd`.

Both need Node.js (current LTS, free from nodejs.org) installed once. If the port is busy you will see `Port 4178 is already in use` — close the other window first.

## Publish to GitHub Pages

This folder is the whole site: push exactly these files to a repo and Pages serves them (multiplayer included, no server to run).

1. Create a Supabase project (free) and note the project URL and anon key under Project Settings → API.
2. Create a new GitHub repo (e.g. `apex-racing`) and push this folder's contents to its root:
   `git init -b main && git add . && git commit -m "APEX classroom racing" && git remote add origin <your-repo-url> && git push -u origin main`
3. On GitHub: Settings → Secrets and variables → Actions → New repository secret, twice: `SUPABASE_URL` (the `https://xyz…` URL) and `SUPABASE_ANON_KEY`. Keys stay in Secrets; they are injected at deploy time and never committed.
4. On GitHub: Settings → Pages → Source → GitHub Actions. Pushes to `main` deploy automatically.
5. Open `https://<you>.github.io/<repo>/` — the host screen lives at `#/host`, and lobby QR codes point at your Pages address automatically.

Classroom day is then just bookmarks: teacher opens `#/host` on the whiteboard, learners scan the QR code. No laptop server needed. (Keep the launchers for fully private LAN races without public hosting.)

## Test

```powershell
cd french-racing
npm test
```

Tests use Node's built-in test runner and have no package dependencies. They cover the published engine/content contract, deterministic seeded bot play, invalid-operation atomicity, corner wear and recovery rules, and the static server's MIME and traversal behavior.

## Browser QA

`npm test` proves the engine, but not that the page boots and plays. Run the headless browser smoke test to drive a full solo race plus a local-grid start in an installed Chromium browser, capture screenshots, and fail on uncaught page errors:

```powershell
npm run qa:browser
```

It uses only Node built-ins and the browser already on the machine. Point `CHROME_PATH` at a specific executable, or set `QA_SHOTS` to choose where screenshots are written (defaults to the OS temp directory). The race is driven with deliberately imperfect answers, so it validates the loop rather than a learner's score.

The game is an MVP prototype. Human playtesting and teacher review are still required for race pacing, browser presentation, and classroom suitability.
