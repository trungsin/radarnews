import type { RadarEnv } from "../env";
import { fetchAllowlisted } from "./http";
import { parsePayload } from "./parse";
import { enabledSources } from "./seed";
import type { CrawlMessage } from "./types";
import { markSourceRun, upsertDocuments } from "./upsert";

function asMessage(raw: unknown): CrawlMessage | null {
  if (!raw || typeof raw !== "object") return null;
  if (!("run_id" in raw) || !("run_day" in raw) || !("source_id" in raw)) return null;
  if (typeof raw.run_id !== "string" || typeof raw.run_day !== "string" || typeof raw.source_id !== "string") {
    return null;
  }
  return { run_id: raw.run_id, run_day: raw.run_day, source_id: raw.source_id };
}

export async function ingestSource(env: RadarEnv, msg: CrawlMessage): Promise<void> {
  const src = enabledSources().find((s) => s.id === msg.source_id);
  if (!src) {
    await markSourceRun(env, msg.run_id, msg.source_id, "fail", 0);
    return;
  }
  const text = await fetchAllowlisted(src.url);
  const docs = parsePayload(src.kind, text);
  const items = await upsertDocuments(env, msg.run_id, msg.run_day, src.id, docs);
  await markSourceRun(env, msg.run_id, src.id, "ok", items);
}

export async function handleCrawlBatch(batch: MessageBatch<unknown>, env: RadarEnv): Promise<void> {
  for (const msg of batch.messages) {
    const parsed = asMessage(msg.body);
    if (!parsed) {
      msg.ack();
      continue;
    }
    try {
      await ingestSource(env, parsed);
      msg.ack();
    } catch {
      msg.retry();
    }
  }
}

export async function handleDlqBatch(batch: MessageBatch<unknown>, env: RadarEnv): Promise<void> {
  for (const msg of batch.messages) {
    const parsed = asMessage(msg.body);
    if (parsed) {
      await markSourceRun(env, parsed.run_id, parsed.source_id, "fail", 0);
      await env.DB.prepare(
        `UPDATE jobs SET notes = COALESCE(notes, '') || ? WHERE run_id = ? AND kind = 'crawl' AND status = 'running'`,
      )
        .bind(` dlq:${parsed.source_id}`, parsed.run_id)
        .run();
    }
    msg.ack();
  }
}
