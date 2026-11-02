# SLF Runway Winds

Crosswind and headwind at the Shuttle Landing Facility (KTTS, runway 15/33 at 330° true).

- **Last hours:** crosswind or head/tailwind from each tower over the last 2 to 12 hours, as
  one-minute values or the highest in each 10 minutes, with KTTS reports and your limit.
- **Now:** the latest reading from WINDS towers 0511 (south end), 0512 (midfield) and 0513
  (north end) at 30 ft, or the latest KTTS METAR, split into crosswind and head/tailwind for
  runway 33, 15 or either end. "Worst of towers" reports any tower over a limit. A short trend
  builds while the page is open.
- **Next 7 days:** the chance of breaking the crosswind, headwind and optional tailwind limits
  typed on the page, using peak gust or sustained wind. Hourly chart, a block table (3-hour,
  6-hour or the 7-Day windows) and a "Check a window" panel with a per-source breakdown and a
  copyable summary.

The page is one static file (`index.html`). `worker/` is a small Cloudflare Worker, the runway
winds service, that keeps the tower history and starts the SLFWeather board on time (below).

## Data

**Forecast guidance** comes from the hourly pipeline in the
[SLFWeather](https://github.com/cyclonecizek/SLFWeather) repo (the 7-Day Constraint
Probabilities board): `https://cyclonecizek.github.io/SLFWeather/data/board.json`, falling back
to the same file on raw.githubusercontent.com. Every member of every source is judged each hour
against the page's limits, with the board's source weights and its window rule (a member counts
once if any hour it has in a window breaks a limit, and must cover at least half the window's
hours). If that board stops updating, this page shows a warning; fix it in SLFWeather.

**Tower observations** come from the WINDS one-minute API on the RAD. The page tries, in order:
1. the runway winds service in `worker/` (latest reading plus up to 24 hours of minute history);
2. the ER Weather COP's Cloudflare minute service (picked up automatically from the COP's
   settings when both sites are opened in the same browser, or entered under Live data settings);
3. `codiapi-winds1.rad.spaceforce.mil/winds/latest` directly (browsers usually block this
   cross-site call);
4. the COP's GitHub snapshot (`ER_Weather_COP/dist/data/latest.json`), about every 5 minutes.

Both workers only answer pages on `https://cyclonecizek.github.io`, which this site is.

**KTTS** comes from api.weather.gov (latest report every minute, the last 12 hours every 10 minutes), with aviationweather.gov as the backup for the latest report.

Without the runway winds service, the Last hours chart only shows readings collected while the page is open.

## Set up

1. Create an empty repository named `SLFRunwayWinds` on GitHub (no README or license).
2. Push this folder to it (see below).
3. Settings > Pages: deploy from branch `main`, folder `/ (root)`.
4. The page is then at `https://cyclonecizek.github.io/SLFRunwayWinds/`.

Limits, runway, wind choice and source switches are kept in each browser only. The page's default
limits are the 7-Day board's standard crosswind and head/tailwind limits, read from `board.json`.

## Runway winds service (`worker/`)

A Cloudflare Worker with one Cron Trigger that runs every minute. Each run:

1. **Tower history.** Reads `winds/latest`, stores towers 0511, 0512 and 0513 in a SQLite Durable
   Object and drops anything older than 24 hours. After the first deployment it tries to fill the
   previous 12 hours from `winds/range`, but only if that API accepts a `tower` filter (it checks
   with a 3-minute probe first, so it never pulls every tower). If not, history builds from the
   first deployment onward.
2. **Starting the board on time.** GitHub only runs a fraction of scheduled workflows on free
   runners: the SLFWeather board was updating every 4–7 hours instead of hourly, even though every
   run succeeded. On the minutes in `DISPATCH` (default `cyclonecizek/SLFWeather/update.yml@25`)
   the worker starts that workflow through GitHub's API, so the board runs every hour. Add more
   entries, separated by spaces, for other repos with the same problem:
   `owner/repo/workflow.yml@MM` (UTC minutes, comma separated; `#branch` for a branch other than main).

Routes: `GET /api/towers?hours=6` (latest and minute history per tower) and `GET /health`
(poll, backfill and dispatch status). Both answer only pages on `ALLOWED_ORIGINS`.

### Deploy

1. **GitHub token.** GitHub > Settings > Developer settings > Personal access tokens >
   Fine-grained tokens > Generate new token. Repository access: *Only select repositories* >
   `SLFWeather` (and any others listed in `DISPATCH`). Repository permissions: **Actions: Read and
   write**. Nothing else. Copy the token. It expires on the date you pick; renew it before then.
2. **Cloudflare.** Workers & Pages > Create application > import a Git repository as a **Worker**,
   pick `cyclonecizek/SLFRunwayWinds`, and use:

   | Setting | Value |
   | --- | --- |
   | Worker name | `slf-runway-winds` |
   | Production branch | `main` |
   | Root directory | `worker` |
   | Build command | `npm test` |
   | Deploy command | `npx wrangler deploy` |

3. Worker > Settings > Variables and Secrets > Add > type **Secret**, name `GITHUB_TOKEN`, paste
   the token. (Leave `ALLOWED_ORIGINS` and `DISPATCH` as the repo sets them.)
4. Worker > Settings > Build > Build watch paths: `worker/*`, so page edits don't redeploy it.
5. Open `https://slf-runway-winds.<your-subdomain>.workers.dev/health`. Within a few minutes it
   should show `"status": "ok"`, a growing `readings` count, and after :25 past the hour a
   `dispatch` entry with `"ok": true`. SLFWeather's Actions tab then shows hourly runs marked
   "Manually run".
6. On the page, open **Live data settings**, paste the workers.dev address under **Runway winds
   service** and click Save. Each browser keeps its own copy of that setting.

The free Workers plan covers this: one request a minute to the RAD and one a minute from each open
page. Tests: `cd worker && npm test`.
