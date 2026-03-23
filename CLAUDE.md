# LLSC Training Organizer — Project Guide


## Your behaviour
Keep your replies extremely concise and focus on conveying the key information. No unnecessary fluff, no long code snippets.|

## What this app is

A **vanilla JS single-page app** (no framework, no build step, no backend) for planning and running circuit workouts. UI is in **German**. No authentication, no database — all persistence is client-side only.

Run by opening `index.html` directly in a browser.

## File map

| File | Role |
|------|------|
| `index.html` | DOM, forms, nav |
| `app.js` | App init, exercise CRUD, import/export, nav |
| `planner.js` | Station/slot layout, drag & drop, print |
| `training.js` | Timer loop, audio cues, wake lock |
| `data.js` | CSV parsing, IndexedDB image store |
| `utils.js` | Colors, badges, filter helpers, ZIP builder |
| `favourites.js` | Save/load workout templates as CSV |
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

## Persistence layers

| Layer | What | Key/Store |
|-------|------|-----------|
| `localStorage` | `exercises[]` as JSON | `'csv_exercises'` |
| `localStorage` | current plan + settings | `'workout_plan'` |
| `IndexedDB` (`TrainingImages`) | exercise images as base64 data URLs | store `images`, keyed by exercise ID |
| File download | CSV or ZIP export | via Blob + `<a>` click |
| File System Access API | favourites CSV (with download fallback) | user-chosen file |

Images are resized to max 800px and compressed as JPEG 0.85 before storage.

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

- No user accounts, authentication, or server-side storage — intentionally.
- No external JS libraries or build tools.
- Everything must work offline from a local file.
- Adding a backend/DB is explicitly out of scope for now.
