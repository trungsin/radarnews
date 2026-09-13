/**
 * Free-tier crawl: run on laptop, write remote D1. Not a Worker.
 * node --experimental-strip-types scripts/crawl-once.ts
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parsePayload } from "../src/crawl/parse.ts";

const RUN_DAY = new Date().toISOString().slice(0, 10);
const RUN_ID = `local_${RUN_DAY}`;
const HN_URL =
  "https://hn.algolia.com/api/v1/search_by_date?query=AI%20LLM%20agent&tags=story&hitsPerPage=30";

function sqlStr(v: string): string {
  return `'${v.replaceAll("'", "''")}'`;
}

function hash(url: string, published: string, title: string): string {
  return createHash("sha256").update(`${url}\0${published}\0${title}`).digest("hex");
}

const res = await fetch(HN_URL, { headers: { "user-agent": "radarnews-pipeline/0.1" } });
if (!res.ok) throw new Error(`hn ${res.status}`);
const docs = parsePayload("hn", await res.text());
const stmts: string[] = [
  `INSERT INTO jobs (id, kind, run_id, run_day, started_at, finished_at, status, items, gemini_rpd_used)
   VALUES (${sqlStr(`job_${RUN_ID}`)}, 'crawl', ${sqlStr(RUN_ID)}, ${sqlStr(RUN_DAY)}, datetime('now'), datetime('now'), 'ok', ${docs.length}, 0)
   ON CONFLICT(id) DO UPDATE SET items = excluded.items, finished_at = excluded.finished_at;`,
];
for (const d of docs) {
  const h = hash(d.url, d.published_at ?? "", d.title);
  const id = `doc_${h.slice(0, 16)}_${RUN_DAY}`;
  stmts.push(
    `INSERT INTO documents (id, source, platform, url, title, published_at, fetched_at, content_hash, interactions, run_id, run_day, status)
     VALUES (${sqlStr(id)}, 'hn-ai', ${sqlStr(d.platform)}, ${sqlStr(d.url)}, ${sqlStr(d.title.slice(0, 500))}, ${d.published_at ? sqlStr(d.published_at) : "NULL"}, datetime('now'), ${sqlStr(h)}, ${d.interactions}, ${sqlStr(RUN_ID)}, ${sqlStr(RUN_DAY)}, 'ok')
     ON CONFLICT(run_day, content_hash) DO UPDATE SET interactions = excluded.interactions, fetched_at = excluded.fetched_at;`,
  );
}

const sql = stmts.join("\n");
const r = spawnSync("npx", ["wrangler", "d1", "execute", "radarnews", "--remote", "--command", sql], {
  stdio: "inherit",
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`wrote ${docs.length} hn docs for ${RUN_DAY}`);
