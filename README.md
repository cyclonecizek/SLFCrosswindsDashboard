# SLF Runway Winds

Live crosswind and head/tailwind observations for the Shuttle Landing Facility.
Runway 33 uses 330 degrees true; runway 15 uses the reciprocal heading.

## Dashboard

- Current winds at the exact 30 ft level for WINDS towers 0511, 0512, and 0513.
- KTTS reports from api.weather.gov, with aviationweather.gov as the latest-report backup.
- Select runway 33, runway 15, or the worst case for either end.
- Select one-minute peak or sustained winds and configure crosswind, headwind, and tailwind limits.
- Observation history for 2, 4, 6, or 12 hours, with one-minute values or trailing 10-minute component maxima.
- Local or Zulu time. Preferences remain in each browser.

Published dashboard: https://cyclonecizek.github.io/SLFCrosswindsDashboard/

## Shared Weather COP update job

No additional cron job, API token, or browser configuration is required.
The existing cron-job.org request continues triggering the ER_Weather_COP
`update-data.yml` workflow with its current URL, headers, and request body.
After collecting its live snapshot and replay data, that workflow runs
`scripts/collect_slf_winds.py` and publishes:

https://cyclonecizek.github.io/ER_Weather_COP/data/slf-winds.json

The SLF history publisher uses observations already fetched by the COP job;
it makes no additional upstream API requests. It retains up to 24 hours of
the three SLF towers. Initial history starts with the COP replay window
(about one hour) and builds over subsequent updates. Missing periods remain
gaps. New live records preserve peak direction; initial replay history may
use mean direction with an approximate-component label.

The dashboard checks this file every 60 seconds, with the matching raw GitHub
file as a fallback. If SLF history is unavailable or incomplete, it also tries
the COP live snapshot. This uses the same publishing cadence as Weather COP;
GitHub queuing and Pages deployment can add latency. KTTS is polled separately
every minute and its 12-hour report history every 10 minutes.

## Data quality

Towers older than five minutes, missing towers, future timestamps, source
errors, and stale publication times prevent a healthy tower status. The
worst-tower readout prefers current observations. Retained readings are
identified as stale. KTTS reports use a separate 90-minute freshness limit.

One-minute peaks use peak direction where available. If peak direction is
missing, the mean direction is used with an approximate-component label.
If no peak speed exists, the displayed calculation identifies use of the mean.
Unknown direction is treated conservatively as fully across and along the runway.

Limits default to crosswind above 10 kt and headwind above 15 kt; tailwind is
off. They are configurable display limits, not an official clearance decision.
All forecast guidance and dependencies on SLFWeather board data are removed
from this dashboard.

## Hosting and checks

GitHub Pages: deploy branch `main`, folder `/ (root)`. The static page uses
`index.html` and `live-data.mjs`; no build step is needed.

Run `node --test tests/*.test.mjs` to check components, observation selection,
freshness, and page dependencies. The existing `worker/` directory is a legacy
optional service; this dashboard no longer calls or requires it. Its deployment
and any separate SLFWeather workflow triggers can be managed independently.
