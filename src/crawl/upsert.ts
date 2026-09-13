import type { RadarEnv } from "../env";
import type { NormalizedDoc } from "./types";
import { contentHash } from "./hash";

export async function upsertDocuments(
  env: RadarEnv,
  runId: string,
  runDay: string,
  sourceId: string,
  docs: NormalizedDoc[],
): Promise<number> {
  let written = 0;
  for (const doc of docs) {
    const hash = await contentHash(doc.url, doc.published_at ?? "", doc.title);
    const id = `doc_${hash.slice(0, 16)}_${runDay}`;
    await env.DB.prepare(
      `INSERT INTO documents (id, source, platform, url, title, published_at, fetched_at, content_hash, interactions, run_id, run_day, status)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, 'ok')
       ON CONFLICT(run_day, content_hash) DO UPDATE SET
         interactions = excluded.interactions,
         fetched_at = excluded.fetched_at,
         run_id = excluded.run_id`,
    )
      .bind(
        id,
        sourceId,
        doc.platform,
        doc.url,
        doc.title.slice(0, 500),
        doc.published_at,
        hash,
        doc.interactions,
        runId,
        runDay,
      )
      .run();
    written += 1;
  }
  return written;
}

export async function markSourceRun(
  env: RadarEnv,
  runId: string,
  sourceId: string,
  status: "ok" | "fail",
  items: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO source_runs (run_id, source_id, status, items, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(run_id, source_id) DO UPDATE SET
       status = excluded.status,
       items = excluded.items,
       updated_at = excluded.updated_at`,
  )
    .bind(runId, sourceId, status, items)
    .run();
}
