# Next: per-user data on the server

## Status (2026-10-13)
- Live at **https://pump.koemerle.ch** behind the shared login (hub-koemerle, see `../../../kin-hub/BUILD.md`).
- Deployed by `kin-hub/new-app`: Coolify builds `Dockerfile` (nginx, port 80) on every push to `main`.
- Still 100 % client-side: exercises in `localStorage`, images in IndexedDB, favourites as CSV files.
  Data is per browser, not per user.

## Goal
Each logged-in user (joel, partner, …) has their own exercises, images, plan, favourites and
history, stored on the server, the same on every device.

## What the platform gives you (no work needed)
- **Login:** done before the request reaches the container. Unauthenticated requests never arrive.
- **Who is it:** every request carries the header **`X-Auth-User: joel`** (set by Traefik after
  the auth check). The backend trusts it and never parses the cookie. Browser-side alternative:
  `fetch("https://auth.koemerle.ch/whoami", {credentials:"include"})` → `{"user":"joel"}`.
- **Storage:** volume mounted at **`/app/data`**, survives redeploys. Everything else in the
  container is wiped on each deploy.

## To decide / build
1. **Backend:** small server that serves the static files *and* a JSON API, all in one container.
   Keep it listening on **port 80**; otherwise the port has to be changed on the Coolify app.
2. **Storage format:** per user, e.g. `/app/data/<user>/…`. Either flat JSON (atomic write:
   temp file + rename) or SQLite. Images as files, not base64 in JSON.
3. **Frontend:** replace the `localStorage`/IndexedDB layer (`data.js`, `app.js`, `favourites.js`,
   `history.js`) with API calls. Keep CSV/ZIP import/export. That is also the migration path:
   export on the old version, import on the new one.
4. **Local dev:** no Traefik locally, so set `X-Auth-User` with a dev fallback (e.g. env var
   `DEV_USER=joel`), and only when running locally.
5. **Update `CLAUDE.md`:** its "no backend, no accounts" constraints no longer apply.

## Deploy
Commit + push to `main` → Coolify redeploys by itself. No Coolify or DNS changes needed.
