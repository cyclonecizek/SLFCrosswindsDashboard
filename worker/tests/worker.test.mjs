import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { pick, parseDispatch, site, TowerStore } from "../src/index.mjs";

const row = (tower, t, spd, extra = {}) => ({ tower, reading_datetime: t, hgt: 30, avg_dir_1min: 90, avg_spd_1min: spd, peak_spd_1min: spd + 4, peak_dir_1min: 95, ...extra });

test("tower ids and wind rows are picked; missing values dropped", () => {
  assert.equal(site("512"), "0512"); assert.equal(site("0313NE"), "0313");
  const r = pick([row("0511", "2026-11-02T17:49:00", 8), row("0001", "2026-11-02T17:49:00", 8), row("0512", "2026-11-02T17:49:00", null, { peak_spd_1min: 999, hgt: 6 }), row("0513", "bad", 5)]);
  assert.deepEqual(r.map(x => x.tower), ["0511"]);
  assert.equal(r[0].t, Date.parse("2026-11-02T17:49:00Z")); assert.equal(r[0].pk, 12);
});

test("dispatch entries parse", () => {
  const d = parseDispatch("cyclonecizek/SLFWeather/update.yml@25 me/Other/run.yaml@5,35#dev junk");
  assert.equal(d.length, 2); assert.deepEqual(d[0].minutes, [25]); assert.equal(d[0].ref, "main"); assert.equal(d[1].ref, "dev"); assert.deepEqual(d[1].minutes, [5, 35]);
});

test("CORS: other origins refused, allowed origin echoed, no public poll route", async () => {
  const calls = [];
  const env = { ALLOWED_ORIGINS: "https://cyclonecizek.github.io", TOWERS: { idFromName: () => "id", get: () => ({ fetch: async u => { calls.push(u); return Response.json({ ok: true }); } }) } };
  assert.equal((await worker.fetch(new Request("https://x.workers.dev/api/towers", { headers: { Origin: "https://evil.example" } }), env)).status, 403);
  const r = await worker.fetch(new Request("https://x.workers.dev/api/towers?hours=4", { headers: { Origin: "https://cyclonecizek.github.io" } }), env);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://cyclonecizek.github.io");
  assert.equal(calls[0], "https://internal/api/towers?hours=4");
  assert.equal((await worker.fetch(new Request("https://x.workers.dev/internal/poll", { method: "POST" }), env)).status, 405);
  assert.equal((await worker.fetch(new Request("https://x.workers.dev/internal/poll"), env)).status, 404);
});

// Full Durable Object run against a real SQLite database where Node provides one.
let sqlite = null; try { sqlite = await import("node:sqlite"); } catch {}
test("store: polls, history, backfill with a tower filter, dispatch once per slot", { skip: !sqlite && "node:sqlite not available" }, async () => {
  const db = new sqlite.DatabaseSync(":memory:");
  const sql = { exec(q, ...p) { const st = db.prepare(q); const rows = /^\s*select/i.test(q) ? st.all(...p) : (st.run(...p), []); return { toArray: () => rows }; } };
  const now = Date.parse("2026-11-02T18:25:00Z"), posts = [];
  const fetcher = async (url, opt = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/latest")) return Response.json([row("0511", "2026-11-02T18:24:00", 9), row("0512", "2026-11-02T18:24:00", 11), row("0513", "2026-11-02T18:24:00", 7), row("0313", "2026-11-02T18:24:00", 20)]);
    if (u.pathname.endsWith("/range")) {
      const tw = u.searchParams.get("tower"), a = Date.parse(u.searchParams.get("date>") + "Z"), b = Date.parse(u.searchParams.get("date<") + "Z"), out = [];
      for (let t = a; t < b; t += 60e3) out.push(row(tw, new Date(t).toISOString().slice(0, 19), 6));
      return Response.json(out);
    }
    if (u.hostname === "api.github.com") { posts.push([u.pathname, JSON.parse(opt.body)]); return new Response(null, { status: 204 }); }
    return new Response("nf", { status: 404 });
  };
  const s = new TowerStore({ storage: { sql } }, { DISPATCH: "cyclonecizek/SLFWeather/update.yml@25", GITHUB_TOKEN: "x" }, fetcher);
  const p = await s.poll(now);
  assert.equal(p.stored, 3); assert.equal(s.meta("backfill").state, "filling");
  assert.deepEqual(posts, [["/repos/cyclonecizek/SLFWeather/actions/workflows/update.yml/dispatches", { ref: "main" }]]);
  await s.poll(now);                                          // same minute again: no second dispatch
  assert.equal(posts.length, 1);
  for (let k = 1; k <= 14; k++) await s.poll(now + k * 60e3); // backfill finishes over the next minutes
  assert.equal(s.meta("backfill").state, "done");
  const h = s.history(12, now + 15 * 60e3);
  assert.ok(h["0512"].length > 700, "about 12 h of minutes"); assert.equal(h["0512"].at(-1)[2], 11);
  assert.equal(new Set(h["0511"].map(r => r[0])).size, h["0511"].length, "one reading per minute");
  const health = await (await s.fetch(new Request("https://internal/health"))).json();
  assert.equal(health.dispatch["cyclonecizek/SLFWeather/update.yml"].ok, true);
});
