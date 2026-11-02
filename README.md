# SLF Runway Winds

Crosswind and headwind at the Shuttle Landing Facility (KTTS, runway 15/33 at 330° true).

- **Now:** the latest reading from WINDS towers 0511 (south end), 0512 (midfield) and 0513
  (north end) at 30 ft, or the latest KTTS METAR, split into crosswind and head/tailwind for
  runway 33, 15 or either end. "Worst of towers" reports any tower over a limit. A short trend
  builds while the page is open.
- **Next 7 days:** the chance of breaking the crosswind, headwind and optional tailwind limits
  typed on the page, using peak gust or sustained wind. Hourly chart, a block table (3-hour,
  6-hour or the 7-Day windows) and a "Check a window" panel with a per-source breakdown and a
  copyable summary.

It is a single static page (`index.html`) with no build step and no workflow of its own.

## Data

**Forecast guidance** comes from the hourly pipeline in the
[SLFWeather](https://github.com/cyclonecizek/SLFWeather) repo (the 7-Day Constraint
Probabilities board): `https://cyclonecizek.github.io/SLFWeather/data/board.json`, falling back
to the same file on raw.githubusercontent.com. Every member of every source is judged each hour
against the page's limits, with the board's source weights and its window rule (a member counts
once if any hour it has in a window breaks a limit, and must cover at least half the window's
hours). If that board stops updating, this page shows a warning; fix it in SLFWeather.

**Tower observations** come from the WINDS one-minute API on the RAD. The page tries, in order:
1. the ER Weather COP's Cloudflare minute service (picked up automatically from the COP's
   settings when both sites are opened in the same browser, or entered under Live data settings);
2. `codiapi-winds1.rad.spaceforce.mil/winds/latest` directly (browsers usually block this
   cross-site call);
3. the COP's GitHub snapshot (`ER_Weather_COP/dist/data/latest.json`), about every 5 minutes.

The worker only answers pages on `https://cyclonecizek.github.io`, which this site is.

**KTTS** comes from api.weather.gov, with aviationweather.gov as the backup.

## Set up

1. Create an empty repository named `SLFRunwayWinds` on GitHub (no README or license).
2. Push this folder to it (see below).
3. Settings > Pages: deploy from branch `main`, folder `/ (root)`.
4. The page is then at `https://cyclonecizek.github.io/SLFRunwayWinds/`.

Limits, runway, wind choice and source switches are kept in each browser only. The page's default
limits are the 7-Day board's standard crosswind and head/tailwind limits, read from `board.json`.
