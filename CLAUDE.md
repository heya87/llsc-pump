# LLSC Training Organizer — Project Guide


## Your behaviour
Keep your replies extremely concise and focus on conveying the key information. No unnecessary fluff, no long code snippets.|

## What this app is

A **vanilla JS single-page app** (no framework, no build step) for planning and running circuit workouts. UI is in **German**. A tiny dependency-free Node server (`server.js`) serves the static files and a per-user JSON API.

Live at https://pump.koemerle.ch behind a shared login (Traefik). The server trusts the **`X-Auth-User`** header set by Traefik; it never handles login itself.

Run locally: `DEV_USER=joel PORT=8080 node server.js` → http://localhost:8080 (data goes to `./data/`). Opening `index.html` as a file no longer works.

Deploy: push to `main` → Coolify builds `Dockerfile` (Node, port 80). Data volume at `/app/data`.

## File map

| File | Role |
|------|------|
| `server.js` | Static files + JSON API, per-user storage |
| `api.js` | Frontend fetch helpers (`Api`, `apiSave`) |
| `index.html` | DOM, forms, nav |
| `app.js` | App init, exercise CRUD, import/export, nav |
| `planner.js` | Station/slot layout, drag & drop, print |
| `training.js` | Timer loop, audio cues, wake lock |
| `data.js` | Server-backed stores: `ExerciseStore`, `ImageStore`, `WeightStore` |
| `utils.js` | Colors, badges, filter helpers, ZIP builder |
| `favourites.js` | Workout templates (server) |
| `history.js` | Training log + weight stats (server) |
| `backup.js` | All file import/export (CSV, ZIP) + "Daten" screen |
| `style.css` | All styling |

## Three main screens

1. **Import/Export** (`app.js`) — manage exercise database
2. **Setup/Planner** (`planner.js`) — build the circuit (assign exercises to stations)
3. **Training** (`training.js`) — run the timed workout

## Core data structures

```js
// Exercise
{ id, name, description, mode, tools, muscleGroup }
// mode: 'no_switch' | 'switch_per_exercise' | 'switch_per_station'

// Plan entry
{ stop: 0, slot: 0, exerciseId: 5 }

// Settings
{ workTime: 45, shortBreak: 15, longBreak: 60, stops: 11 }
```

## Stations and slots

- Each circuit has N **stations** (stops), default 11, configurable 1–20.
- Each station has **2 slots** (slot 0 and slot 1).
- The plan array is a flat list of `{ stop, slot, exerciseId }` entries.

### Exercise modes

| Mode | Behaviour |
|------|-----------|
| `no_switch` | Normal single-sided exercise, fills one slot |
| `switch_per_exercise` | Bilateral; one slot, beep at halftime for side switch |
| `switch_per_station` | Bilateral; **auto-fills both slots** with same exercise, side 1 then side 2 |

`canPlaceAt()` in `planner.js` enforces placement rules (e.g. can't mix a `switch_per_station` exercise with another exercise in the same station).

## Persistence (server, per user)

Files under `DATA_DIR/<user>/` (`/app/data` in the container), written atomically (temp + rename):

| File | API | Content |
|------|-----|---------|
| `exercises.json` | `GET/PUT api/exercises` | `exercises[]` |
| `workout.json` | `GET/PUT api/workout` | `{ plan, settings }` |
| `favourites.json` | `GET/PUT api/favourites` | `[{ name, plan }]` |
| `history.json` | `GET/PUT api/history`, `POST api/history/append` | flat session rows |
| `weights.json` | `GET/PUT api/weights`, `POST api/weights/append` | `[{ exerciseId, weightKg, date }]` |
| `images/{id}.jpg` | `GET/PUT/DELETE api/images/{id}`, `GET api/images` → `{id: mtime}` | JPEG |

Frontend loads everything once at init and keeps it in memory; saves are PUT/POST (`queuedPut` coalesces rapid saves in order). Last write wins across devices.
Images are resized to max 800px and compressed as JPEG 0.85 before upload.
File import/export (CSV/ZIP) lives only in `backup.js` and the "Daten" screen (nav icon); the other screens don't touch files.

## CSV format (semicolon-delimited)

```csv
id;name;description;mode;tools;muscleGroup
1;Liegestütze;Arme schulterbreit;no_switch;;Brust
```

ZIP export bundles `exercises.csv` + image files named `{id}.jpg`.

## Print mode

`exportStationSheets()` in `planner.js` opens a new window with one A4 page per station. Each page shows both exercises with image, description, tags, and timing text. Timing text varies by mode (normal vs. per-station side switching).

## Training timer

- Phases are built from the plan: work → short break → work → long break (transition), repeating per station.
- Timer uses wall-clock `Date.now()` for drift correction, ticks every 250ms.
- Pause time is accumulated separately so the timer stays accurate.
- Audio: 4-beep countdown at end of each phase; halftime beep for `switch_per_exercise`.
- Screen Wake Lock API keeps display on during training.

## Mode normalisation

Legacy German strings in imported CSV are normalised by `normalizeMode()` in `data.js`:
- `"Kein Wechsel"` → `no_switch`
- `"Seitenwechsel pro Übung"` / `"Halftime_Switch"` → `switch_per_exercise`
- `"Seitenwechsel pro Station"` → `switch_per_station`

## Constraints / non-goals

- No login/accounts in the app itself — authentication is done by the platform (Traefik), user from `X-Auth-User`.
- No external JS libraries, no npm dependencies, no build tools.
