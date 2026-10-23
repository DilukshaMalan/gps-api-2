# GPS API (QuickRentCar tracking service) — Node.js

Read-only service that exposes GPS trips and positions. It knows nothing about rentals, bookings or
package distance — the iOS app / your own backend combines those with this data.

This is a **Node.js** version of the earlier Python/Flask service, with the same endpoints, JSON
shapes and error format. It has **no npm dependencies** (it uses only Node's built-in modules), so there is nothing
to `npm install`.

## Run

Needs **Node.js 20 or newer** (`node --version`). Download it from nodejs.org if needed.

```bash
npm start                  # http://localhost:8000
npm test                   # 26 tests
```

Settings are environment variables (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8000` | Port to listen on (Railway and Render set this for you) |
| `GPS_API_KEY` | unset | When set, every request except `/api/v1/health` must send `X-API-Key: <value>` |
| `GPS_DATA_DIR` | `./data` | Folder with the `*_trips.json` files |
| `GPS_MAX_RANGE_DAYS` | `31` | Longest allowed `from`–`to` window |
| `GPS_GZIP_MIN_BYTES` | `1000` | Smaller responses are not compressed |
| `GPS_ACCESS_LOG` | `0` | `1` prints one log line per request |

To load a `.env` file locally: `node --env-file=.env index.js`.

## Data files

Put the generated files in `data/`:

```
data/QR-001_trips.json
data/QR-002_trips.json
data/QR-003_trips.json
```

Every `*_trips.json` found there becomes a vehicle (its `vehicleId` is the id used in URLs). The files are
validated and loaded into memory once at start-up, so restart after replacing one. If a file is
malformed the server refuses to start and says which file and field is wrong. `vehicles_index.json` is
not read — the API derives the same information from the trip files.

## Endpoints

| Method and path | Purpose |
|---|---|
| `GET /api/v1/vehicles/{vehicleId}/position` | Latest position, speed and engine state |
| `GET /api/v1/vehicles/{vehicleId}/trips?from=&to=` | Trip summaries overlapping the window |
| `GET /api/v1/vehicles/{vehicleId}/trips?from=&to=&includePoints=true&maxPoints=5000` | Same trips with GPS points clipped to the window; `maxPoints` thins them (first and last point of each trip are kept) |
| `GET /api/v1/vehicles/{vehicleId}/trips/{tripId}?maxPoints=` | One trip with its points |
| `GET /api/v1/vehicles` | Vehicles with data range and last position |
| `GET /api/v1/health` | Liveness check (never needs the API key) |

Rules: `from` and `to` are ISO 8601 **with an offset**, e.g. `2026-10-14T00:00:00+05:30` (or `...Z`); `to` must
not be before `from`; the window may be at most 31 days; `maxPoints` is 50–50000. Errors always look like
`{"error": {"code": "...", "message": "..."}}` with 400, 401, 404 or 405.

A `+` in a URL must be sent as `%2B`. If a client forgets, the API repairs it, but encode it properly.

```bash
curl "http://localhost:8000/api/v1/vehicles/QR-001/position"
curl "http://localhost:8000/api/v1/vehicles/QR-001/trips?from=2026-10-16T00:00:00%2B05:30&to=2026-10-16T23:59:59%2B05:30"
curl -H "Accept-Encoding: gzip" --compressed \
  "http://localhost:8000/api/v1/vehicles/QR-003/trips?from=2026-10-12T00:00:00%2B05:30&to=2026-10-18T23:59:59%2B05:30&includePoints=true&maxPoints=5000"
```

Responses over 1 KB are gzip-compressed when the client sends `Accept-Encoding: gzip` (URLSession does
this automatically). Trip responses carry an `ETag`, so a repeat request with `If-None-Match` returns `304`.

## Deploy (Railway or Render)

1. Push this folder to a GitHub repo (`node_modules`, `.env` are already in `.gitignore`; keep `data/`).
2. **Railway:** New Project → Deploy from GitHub repo. It detects Node and runs `npm start`. Add the variable
   `GPS_API_KEY`, then Settings → Networking → Generate Domain.
3. **Render:** New → Web Service → connect the repo. Build command `npm install`, start command `npm start`,
   add `GPS_API_KEY`, health check path `/api/v1/health`.
4. Check `https://<your-domain>/api/v1/health` returns `{"status":"ok","vehicles":3}`.

The server listens on the `PORT` the platform provides and shuts down cleanly on `SIGTERM` (sent on every redeploy).

## Layout

```
index.js                         entry point: port, start-up, graceful shutdown
src/app.js                       wires everything together; key check -> routing -> handler -> ETag/gzip
src/config.js                    settings from environment variables
src/models/telemetry.js          the JSON contract: validates data files, builds response objects
src/services/telemetryService.js loads the JSON files, window clipping (binary search), downsampling
src/routes/vehicles.js           the endpoints above
src/routes/health.js             /health
src/core/                        errors, API key check, gzip, query parsing, strict date parsing
data/                            the *_trips.json files
tests/api.test.js                tests (node:test)
```

The service and models contain no HTTP code, so if you later prefer Express or Fastify only `src/app.js`
and the small handlers in `src/routes` need to change.
