// SLF Runway Winds data service (Cloudflare Worker + SQLite Durable Object).
//
// Every minute (Cron Trigger):
//   1. Reads the WINDS one-minute API (winds/latest) and stores towers 0511, 0512 and 0513,
//      keeping KEEP_HOURS of history, so the page can draw the last few hours.
//   2. On the minutes listed in DISPATCH, starts GitHub workflows with workflow_dispatch.
//      GitHub drops most "schedule" runs on busy free runners; this starts the SLFWeather
//      board (the page's forecast guidance) on time every hour.
// Public routes (CORS limited to ALLOWED_ORIGINS):
//   GET /api/towers?hours=6   latest reading and per-minute history for each tower
//   GET /health               poll, backfill and dispatch status

export const TOWERS = ["0511", "0512", "0513"];
export const LATEST = "https://codiapi-winds1.rad.spaceforce.mil/winds/latest";
export const RANGE = "https://codiapi-winds1.rad.spaceforce.mil/winds/range";
const KEEP_HOURS = 24, MAX_HOURS = 24, MIN = 60e3, H = 3600e3;
const BACKFILL_HOURS = 12, BACKFILL_CHUNK_H = 3;

const res = (v, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export const site = t => { const m = /^(\d{1,4})(N|NE|E|SE|S|SW|W|NW)?$/.exec(String(t ?? "")); return m ? m[1].padStart(4, "0") : String(t); };
export const num = v => typeof v === "number" && Number.isFinite(v) && v !== 999 && v !== 9999 && v > -99 ? v : null;
const asUTC = s => s && (/Z$|[+-]\d\d:\d\d$/.test(s) ? s : s + "Z");
const iso = ms => new Date(ms).toISOString().slice(0, 19);

/** Wind readings for the SLF towers from a WINDS response (rows without wind are dropped). */
export function pick(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const tower = site(r.tower); if (!TOWERS.includes(tower)) continue;
    const spd = num(r.avg_spd_1min), pk = num(r.peak_spd_1min); if (spd == null && pk == null) continue;
    const t = Date.parse(asUTC(r.reading_datetime)); if (!Number.isFinite(t)) continue;
    out.push({ tower, t, hgt: num(r.hgt) ?? -1, dir: num(r.avg_dir_1min), spd, pk, pkdir: num(r.peak_dir_1min) });
  }
  return out;
}

/** "owner/repo/workflow.yml@MM[,MM]" entries, comma or space separated. */
export function parseDispatch(text) {
  const out = [];
  for (const part of String(text || "").split(/[\s;]+/).filter(Boolean)) {
    const m = /^([\w.-]+)\/([\w.-]+)\/([\w.-]+\.ya?ml)@([\d,]+)(?:#([\w./-]+))?$/.exec(part);
    if (!m) continue;
    out.push({ owner: m[1], repo: m[2], workflow: m[3], minutes: m[4].split(",").map(Number).filter(n => n >= 0 && n < 60), ref: m[5] || "main", key: `${m[1]}/${m[2]}/${m[3]}` });
  }
  return out;
}

async function getJSON(url, fetcher = fetch, ms = 20000) {
  const r = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "SLF-Runway-Winds/1.0" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

export class TowerStore {
  constructor(ctx, env, fetcher) {
    this.ctx = ctx; this.env = env; this.fetcher = fetcher || ((...a) => fetch(...a)); this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS obs (tower TEXT NOT NULL, t INTEGER NOT NULL, hgt REAL NOT NULL, dir REAL, spd REAL, pk REAL, pkdir REAL, PRIMARY KEY (tower, t, hgt))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
  }
  meta(k, v) {
    if (v === undefined) { const row = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0]; return row ? JSON.parse(row.v) : null; }
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, JSON.stringify(v));
  }
  store(rows) {
    for (const r of rows) this.sql.exec("INSERT OR REPLACE INTO obs (tower, t, hgt, dir, spd, pk, pkdir) VALUES (?, ?, ?, ?, ?, ?, ?)", r.tower, r.t, r.hgt, r.dir, r.spd, r.pk, r.pkdir);
    return rows.length;
  }
  async poll(now) {
    const status = { at: new Date(now).toISOString() };
    try {
      const n = this.store(pick(await getJSON(LATEST, this.fetcher)));
      status.ok = n > 0; status.stored = n; if (!n) status.error = "No 0511-0513 wind readings in winds/latest";
    } catch (e) { status.ok = false; status.error = String(e.message || e); }
    this.sql.exec("DELETE FROM obs WHERE t < ?", now - KEEP_HOURS * H);
    this.meta("poll", status);
    try { await this.backfill(now); } catch (e) { this.meta("backfill", { ...(this.meta("backfill") || {}), error: String(e.message || e) }); }
    await this.dispatch(now);
    return status;
  }
  // One-time history fill after deployment. The range API is only used if it accepts a tower filter
  // (checked with a 3-minute probe), so no request ever pulls every tower's data.
  async backfill(now) {
    let b = this.meta("backfill") || { state: "probe" };
    if (b.state === "done" || b.state === "unsupported") return;
    if (b.state === "probe") {
      const url = new URL(RANGE);
      for (const [k, v] of Object.entries({ "date>": iso(now - 4 * MIN), "date<": iso(now), tower: "0512", sort: "asc" })) url.searchParams.set(k, v);
      const rows = await getJSON(url.toString(), this.fetcher);
      const ok = Array.isArray(rows) && rows.length > 0 && rows.length < 60 && rows.every(r => site(r.tower) === "0512");
      b = ok ? { state: "filling", jobs: TOWERS.flatMap(tw => Array.from({ length: BACKFILL_HOURS / BACKFILL_CHUNK_H }, (_, i) => [tw, now - (i + 1) * BACKFILL_CHUNK_H * H, now - i * BACKFILL_CHUNK_H * H])), filled: 0 }
             : { state: "unsupported", note: "winds/range ignores the tower filter; history builds from the minute polls", rows: Array.isArray(rows) ? rows.length : null };
      this.meta("backfill", b); return;
    }
    const job = b.jobs.shift();                       // one request per minute keeps each run light
    if (job) {
      const [tw, a, z] = job, url = new URL(RANGE);
      for (const [k, v] of Object.entries({ "date>": iso(a), "date<": iso(z), tower: tw, sort: "asc" })) url.searchParams.set(k, v);
      const rows = pick(await getJSON(url.toString(), this.fetcher, 30000)).filter(r => r.tower === tw);
      b.filled += this.store(rows);
    }
    if (!b.jobs.length) b = { state: "done", filled: b.filled, at: new Date(now).toISOString() };
    this.meta("backfill", b);
  }
  async dispatch(now) {
    const list = parseDispatch(this.env.DISPATCH); if (!list.length) return;
    const d = new Date(now), minute = d.getUTCMinutes(), slot = `${iso(now).slice(0, 13)}:${String(minute).padStart(2, "0")}`;
    const log = this.meta("dispatch") || {};
    for (const job of list) {
      if (!job.minutes.includes(minute) || (log[job.key] && log[job.key].slot === slot)) continue;
      const entry = { slot, at: d.toISOString() };
      if (!this.env.GITHUB_TOKEN) entry.error = "GITHUB_TOKEN secret not set";
      else {
        try {
          const r = await this.fetcher(`https://api.github.com/repos/${job.owner}/${job.repo}/actions/workflows/${job.workflow}/dispatches`, {
            method: "POST", signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "SLF-Runway-Winds/1.0", "Content-Type": "application/json" },
            body: JSON.stringify({ ref: job.ref })
          });
          entry.status = r.status; entry.ok = r.status === 204;
          if (!entry.ok) entry.error = (await r.text()).slice(0, 300);
        } catch (e) { entry.ok = false; entry.error = String(e.message || e); }
      }
      log[job.key] = entry;
    }
    this.meta("dispatch", log);
  }
  history(hours, now) {
    const since = now - Math.min(MAX_HOURS, Math.max(1, hours)) * H, towers = {};
    for (const tw of TOWERS) {
      const rows = this.sql.exec("SELECT t, hgt, dir, spd, pk, pkdir FROM obs WHERE tower = ? AND t >= ? ORDER BY t, hgt", tw, since).toArray();
      // one reading per minute: the height nearest 30 ft
      const by = new Map();
      for (const r of rows) { const o = by.get(r.t); if (!o || Math.abs(r.hgt - 30) < Math.abs(o.hgt - 30)) by.set(r.t, r); }
      towers[tw] = [...by.values()].map(r => [r.t, r.dir, r.spd, r.pk, r.pkdir, r.hgt]);
    }
    return towers;
  }
  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    if (url.pathname === "/internal/poll" && request.method === "POST") return res(await this.poll(Number(url.searchParams.get("now")) || now));
    if (url.pathname === "/health") {
      const poll = this.meta("poll"), age = poll ? now - Date.parse(poll.at) : null;
      const n = this.sql.exec("SELECT COUNT(*) AS n, MIN(t) AS a, MAX(t) AS b FROM obs").toArray()[0];
      return res({ status: !poll ? "warming_up" : age > 3 * MIN ? "poll_delayed" : poll.ok ? "ok" : "degraded", poll, readings: n.n,
        oldest: n.a ? new Date(n.a).toISOString() : null, newest: n.b ? new Date(n.b).toISOString() : null,
        backfill: this.meta("backfill"), dispatch: this.meta("dispatch"), dispatch_config: parseDispatch(this.env.DISPATCH).map(j => `${j.key}@${j.minutes.join(",")}`) });
    }
    const hours = Number(url.searchParams.get("hours")) || 6, poll = this.meta("poll");
    return res({ generated_at: new Date(now).toISOString(), polled_at: poll ? poll.at : null, poll_ok: poll ? !!poll.ok : false,
      fields: ["t_ms", "dir", "spd", "peak", "peak_dir", "hgt_ft"], units: "kt, degrees true", towers: this.history(hours, now) });
  }
}

const STORE = "slf-runway-winds-v1";
const stub = env => env.TOWERS.get(env.TOWERS.idFromName(STORE));
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stub(env).fetch(`https://internal/internal/poll?now=${event.scheduledTime}`, { method: "POST" }).then(r => { if (!r.ok) throw new Error("poll failed " + r.status); }));
  },
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return res({ error: "Origin not allowed" }, 403);
    const cors = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    if (request.method !== "GET") return res({ error: "Method not allowed" }, 405);
    if (!["/", "/health", "/api/towers"].includes(url.pathname)) return res({ error: "Not found" }, 404);
    const r = await stub(env).fetch("https://internal" + (url.pathname === "/health" ? "/health" : "/api/towers") + url.search);
    const out = new Response(r.body, r); for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};
