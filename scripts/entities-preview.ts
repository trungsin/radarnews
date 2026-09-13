/**
 * Sanity check (no rust): pull today's docs from D1, show entity distribution.
 * node --experimental-strip-types scripts/entities-preview.ts
 */
import { spawnSync } from "node:child_process";
import { extractEntities } from "../src/graph/entities.ts";

const RUN_DAY = new Date().toISOString().slice(0, 10);

type DocRow = { platform: string; url: string; title: string; interactions: number };

const r = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "radarnews",
    "--remote",
    "--json",
    "--command",
    `SELECT platform, url, title, interactions FROM documents WHERE run_day = '${RUN_DAY}'`,
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (r.status !== 0) {
  process.stderr.write(r.stderr ?? "");
  process.exit(r.status ?? 1);
}
const payload = JSON.parse(r.stdout);
const first = Array.isArray(payload) ? payload[0] : null;
const docs: DocRow[] = first && "results" in first && Array.isArray(first.results) ? first.results : [];

const count = new Map<string, number>();
let withEntity = 0;
for (const doc of docs) {
  const ents = extractEntities(doc);
  if (ents.length > 0) withEntity += 1;
  for (const e of ents) {
    const key = `${e.kind}:${e.name}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
}
const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(`docs ${docs.length}, with >=1 entity ${withEntity}`);
for (const [k, n] of top) console.log(`${String(n).padStart(3)}  ${k}`);
