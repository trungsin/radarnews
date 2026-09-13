/**
 * Free-tier crawl: run on laptop / GitHub Action, write remote D1. Not a Worker.
 * Collects all rows, writes one .sql file, runs a single wrangler d1 execute.
 * node --experimental-strip-types scripts/crawl-once.ts
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePayload } from "../src/crawl/parse.ts";
import type { AllowlistedSource, SourceKind } from "../src/crawl/types.ts";

const RUN_DAY = new Date().toISOString().slice(0, 10);
const RUN_ID = `local_${RUN_DAY}`;
const CAP_PER_SOURCE = 60;

const allowlistPath = fileURLToPath(new URL("../src/crawl/allowlist.json", import.meta.url));
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8")) as { sources: AllowlistedSource[] };
const KINDS: readonly SourceKind[] = ["hn", "hf", "github", "arxiv", "bluesky", "rss"];

function sqlStr(v: string): string {
  return `'${v.replaceAll("'", "''")}'`;
}

function hash(url: string, published: string, title: string): string {
  return createHash("sha256").update(`${url}\0${published}\0${title}`).digest("hex");
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

const stmts: string[] = [
  `INSERT INTO jobs (id, kind, run_id, run_day, started_at, status, items, gemini_rpd_used)
   VALUES (${sqlStr(`job_${RUN_ID}`)}, 'crawl', ${sqlStr(RUN_ID)}, ${sqlStr(RUN_DAY)}, datetime('now'), 'running', 0, 0)
   ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, status = 'running';`,
];

let total = 0;
let failed = 0;
for (const src of allowlist.sources) {
  if (!src.enabled || !KINDS.includes(src.kind)) continue;
  if (src.kind === "arxiv") await sleep(3000);
  try {
    const res = await fetch(src.url, { headers: { "user-agent": "radarnews-pipeline/0.1" } });
    if (!res.ok) throw new Error(`${src.id} http ${res.status}`);
    const docs = parsePayload(src.kind, await res.text()).filter((d) => d.url).slice(0, CAP_PER_SOURCE);
    for (const d of docs) {
      const h = hash(d.url, d.published_at ?? "", d.title);
      const id = `doc_${h.slice(0, 16)}_${RUN_DAY}`;
      stmts.push(
        `INSERT INTO documents (id, source, platform, url, title, published_at, fetched_at, content_hash, interactions, run_id, run_day, status)
         VALUES (${sqlStr(id)}, ${sqlStr(src.id)}, ${sqlStr(d.platform)}, ${sqlStr(d.url)}, ${sqlStr(d.title.slice(0, 500))}, ${d.published_at ? sqlStr(d.published_at) : "NULL"}, datetime('now'), ${sqlStr(h)}, ${d.interactions}, ${sqlStr(RUN_ID)}, ${sqlStr(RUN_DAY)}, 'ok')
         ON CONFLICT(run_day, content_hash) DO UPDATE SET interactions = excluded.interactions, fetched_at = excluded.fetched_at;`,
      );
    }
    stmts.push(
      `INSERT INTO source_runs (run_id, source_id, status, items, updated_at)
       VALUES (${sqlStr(RUN_ID)}, ${sqlStr(src.id)}, 'ok', ${docs.length}, datetime('now'))
       ON CONFLICT(run_id, source_id) DO UPDATE SET status = 'ok', items = excluded.items, updated_at = excluded.updated_at;`,
    );
    total += docs.length;
    console.log(`${src.id}: ${docs.length}`);
  } catch (err) {
    failed += 1;
    console.error(`${src.id} FAIL: ${(err as Error).message}`);
    stmts.push(
      `INSERT INTO source_runs (run_id, source_id, status, items, updated_at)
       VALUES (${sqlStr(RUN_ID)}, ${sqlStr(src.id)}, 'fail', 0, datetime('now'))
       ON CONFLICT(run_id, source_id) DO UPDATE SET status = 'fail', updated_at = excluded.updated_at;`,
    );
  }
}

stmts.push(
  `UPDATE jobs SET status = ${failed > 0 ? "'partial'" : "'ok'"}, items = ${total}, finished_at = datetime('now')
   WHERE id = ${sqlStr(`job_${RUN_ID}`)};`,
);

const sqlFile = join(tmpdir(), `radarnews-${RUN_ID}.sql`);
writeFileSync(sqlFile, stmts.join("\n"));
const r = spawnSync("npx", ["wrangler", "d1", "execute", "radarnews", "--remote", "--file", sqlFile], {
  stdio: ["ignore", "ignore", "inherit"],
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`done: ${total} docs, ${failed} source failures, ${RUN_DAY}`);
