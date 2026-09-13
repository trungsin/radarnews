/**
 * Free-tier Leiden: read D1 -> CSR file -> leiden-run binary -> community_id + heat -> D1.
 * Runs on a machine with rustc (GitHub Action or laptop). Not a Worker.
 * node --experimental-strip-types scripts/leiden-local.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeCsr, undirectedGraph } from "../src/graph/csr.ts";
import { extractEntities } from "../src/graph/entities.ts";

const RUN_DAY = new Date().toISOString().slice(0, 10);
const RUN_ID = `leidenlocal_${RUN_DAY}`;
const BIN = "./crates/leiden-run/target/release/leiden-run";

type DocRow = { id: string; platform: string; url: string; title: string; source: string; interactions: number };

function d1Json(command: string): unknown {
  const r = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "radarnews", "--remote", "--json", "--command", command],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    process.stderr.write(r.stderr ?? "");
    process.exit(r.status ?? 1);
  }
  return JSON.parse(r.stdout);
}

function d1Exec(sql: string): void {
  const file = join(tmpdir(), `radarnews-leiden-${RUN_ID}.sql`);
  writeFileSync(file, sql);
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "radarnews", "--remote", "--file", file], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function sqlStr(v: string): string {
  return `'${v.replaceAll("'", "''")}'`;
}

function rowsOf(payload: unknown): DocRow[] {
  if (!Array.isArray(payload)) return [];
  const first = payload[0];
  if (!first || typeof first !== "object" || !("results" in first)) return [];
  const results = first.results;
  return Array.isArray(results) ? (results as DocRow[]) : [];
}

const docs = rowsOf(
  d1Json(
    `SELECT id, platform, url, title, source, interactions FROM documents WHERE run_day = '${RUN_DAY}'`,
  ),
);
if (docs.length === 0) {
  console.log(`no documents for ${RUN_DAY}; nothing to cluster`);
  process.exit(0);
}

// Entity-document graph via rule-based extraction. No platform-host hubs.
const pairs: Array<{ a: string; b: string; w: number }> = [];
const interactionsByNode = new Map<string, number>();
for (const doc of docs) {
  const docNode = `doc:${doc.id}`;
  interactionsByNode.set(docNode, doc.interactions);
  for (const e of extractEntities(doc)) {
    pairs.push({ a: docNode, b: `ent:${e.kind}:${e.name}`, w: e.kind === "concept" ? 0.7 : 1 });
  }
  // No src node: docs connect ONLY through shared entities. Entity-less docs
  // drop out as noise rather than clustering by platform.
}

const graph = undirectedGraph(pairs);
const csrFile = join(tmpdir(), `radarnews-${RUN_DAY}.csr`);
writeFileSync(csrFile, Buffer.from(encodeCsr(graph)));

const outFile = join(tmpdir(), `radarnews-${RUN_DAY}.assignment.json`);
const run = spawnSync(BIN, ["--csr", csrFile, "--out", outFile], { stdio: ["ignore", "inherit", "inherit"] });
if (run.status !== 0) {
  console.error("leiden-run failed");
  process.exit(run.status ?? 1);
}

type Assignment = { quality: number; membership: Array<{ dense_id: number; community: number }> };
const assignment = JSON.parse(readFileSync(outFile, "utf8")) as Assignment;

// Group dense ids by community; keep only communities with >=2 documents.
const membersByComm = new Map<number, string[]>();
for (const m of assignment.membership) {
  const label = graph.labels[m.dense_id];
  const list = membersByComm.get(m.community) ?? [];
  list.push(label);
  membersByComm.set(m.community, list);
}

const stmts: string[] = [
  `INSERT INTO jobs (id, kind, run_id, run_day, started_at, finished_at, status, items, gemini_rpd_used)
   VALUES (${sqlStr(`job_${RUN_ID}`)}, 'leiden', ${sqlStr(RUN_ID)}, ${sqlStr(RUN_DAY)}, datetime('now'), datetime('now'), 'ok', ${membersByComm.size}, 0)
   ON CONFLICT(id) DO UPDATE SET finished_at = excluded.finished_at, items = excluded.items, status = 'ok';`,
  `DELETE FROM communities WHERE run_day = '${RUN_DAY}';`,
  `DELETE FROM node_communities WHERE run_day = '${RUN_DAY}';`,
];

let rank = 0;
const ranked = [...membersByComm.entries()]
  .map(([community, labels]) => {
    const docLabels = labels.filter((l) => l.startsWith("doc:"));
    let heat = 0;
    for (const l of docLabels) heat += Math.log1p(interactionsByNode.get(l) ?? 0);
    return { community, labels, docLabels, heat };
  })
  .filter((c) => c.docLabels.length >= 2)
  .sort((a, b) => b.heat - a.heat);

for (const c of ranked) {
  rank += 1;
  const cid = `c_${RUN_DAY}_${c.community}`;
  const entLabels = c.labels.filter((l) => l.startsWith("ent:")).sort().slice(0, 8).join("|");
  const stableKey = `sk_${Buffer.from(entLabels).toString("base64url").slice(0, 24)}`;
  stmts.push(
    `INSERT INTO communities (id, run_day, run_id, algo, resolution, size, heat, rank, stable_key)
     VALUES (${sqlStr(cid)}, ${sqlStr(RUN_DAY)}, ${sqlStr(RUN_ID)}, 'leiden', NULL, ${c.docLabels.length}, ${c.heat.toFixed(4)}, ${rank}, ${sqlStr(stableKey)});`,
  );
  for (const l of c.docLabels) {
    stmts.push(
      `INSERT INTO node_communities (node_id, node_type, community_id, run_day)
       VALUES (${sqlStr(l)}, 'doc', ${sqlStr(cid)}, ${sqlStr(RUN_DAY)})
       ON CONFLICT(node_id, node_type, run_day) DO UPDATE SET community_id = excluded.community_id;`,
    );
  }
}

d1Exec(stmts.join("\n"));
console.log(`leiden ${RUN_DAY}: ${ranked.length} communities (quality ${assignment.quality.toFixed(4)})`);
