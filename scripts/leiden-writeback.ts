/**
 * Operator/CI writeback. Values are integers + validated run_day only.
 * Usage: node --experimental-strip-types scripts/leiden-writeback.ts assignment.json RUN_DAY RUN_ID
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [assignmentPath, runDay, runId] = process.argv.slice(2);
if (!assignmentPath || !runDay || !runId) {
  throw new Error("usage: leiden-writeback assignment.json RUN_DAY RUN_ID");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(runDay)) {
  throw new Error("bad run_day");
}
if (!/^[\w.-]+$/.test(runId)) {
  throw new Error("bad run_id");
}

type Assignment = {
  quality: number;
  membership: Array<{ dense_id: number; community: number }>;
};

const assignment = JSON.parse(readFileSync(assignmentPath, "utf8")) as Assignment;
const byComm = new Map<number, number[]>();
for (const row of assignment.membership) {
  if (!Number.isInteger(row.dense_id) || !Number.isInteger(row.community)) {
    throw new Error("non-integer membership");
  }
  const list = byComm.get(row.community) ?? [];
  list.push(row.dense_id);
  byComm.set(row.community, list);
}

const statements: string[] = [];
statements.push(
  `INSERT INTO jobs (id, kind, run_id, run_day, started_at, status, items, gemini_rpd_used)
   VALUES ('leiden_${runDay}', 'leiden', '${runId}', '${runDay}', datetime('now'), 'running', 0, 0);`,
);
for (const [community, nodes] of byComm) {
  const cid = `c_${runDay}_${community}`;
  const stable = `sk_${community}`;
  statements.push(
    `INSERT INTO communities (id, run_day, run_id, algo, resolution, size, heat, rank, stable_key)
     VALUES ('${cid}', '${runDay}', '${runId}', 'leiden', NULL, ${nodes.length}, 0, ${community}, '${stable}');`,
  );
  for (const dense of nodes) {
    statements.push(
      `INSERT INTO node_communities (node_id, node_type, community_id, run_day)
       VALUES ('dense_${dense}', 'dense', '${cid}', '${runDay}');`,
    );
  }
}
statements.push(
  `UPDATE jobs SET status = 'ok', finished_at = datetime('now') WHERE id = 'leiden_${runDay}';`,
);

const sql = statements.join("\n");
const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "radarnews", "--remote", "--command", sql],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
