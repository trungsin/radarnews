import type { RadarEnv } from "../env";
import allowlist from "./allowlist.json";
import type { AllowlistedSource, CrawlMessage, SourceKind } from "./types";

function isKind(kind: string): kind is SourceKind {
  return kind === "hn" || kind === "hf" || kind === "github" || kind === "arxiv" || kind === "bluesky" || kind === "rss";
}

function sourcesFromAllowlist(): AllowlistedSource[] {
  const out: AllowlistedSource[] = [];
  for (const raw of allowlist.sources) {
    if (!isKind(raw.kind)) continue;
    out.push({ id: raw.id, kind: raw.kind, url: raw.url, enabled: raw.enabled });
  }
  return out;
}

const sources = sourcesFromAllowlist();

export function enabledSources(): AllowlistedSource[] {
  return sources.filter((s) => s.enabled);
}

export async function seedSources(env: RadarEnv): Promise<void> {
  for (const src of sources) {
    await env.DB.prepare(
      `INSERT INTO sources (id, kind, url, enabled) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, url = excluded.url, enabled = excluded.enabled`,
    )
      .bind(src.id, src.kind, src.url, src.enabled ? 1 : 0)
      .run();
  }
}

export async function openSourceRuns(env: RadarEnv, runId: string): Promise<void> {
  for (const src of enabledSources()) {
    await env.DB.prepare(
      `INSERT INTO source_runs (run_id, source_id, status, items, updated_at)
       VALUES (?, ?, 'pending', 0, datetime('now'))
       ON CONFLICT(run_id, source_id) DO NOTHING`,
    )
      .bind(runId, src.id)
      .run();
  }
}

export function queueMessages(runId: string, runDay: string): CrawlMessage[] {
  return enabledSources()
    .filter((s) => s.kind !== "arxiv")
    .map((s) => ({ run_id: runId, run_day: runDay, source_id: s.id }));
}

export function arxivSources(): AllowlistedSource[] {
  return enabledSources().filter((s) => s.kind === "arxiv");
}

export async function pendingCount(env: RadarEnv, runId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM source_runs WHERE run_id = ? AND status = 'pending'`,
  )
    .bind(runId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function finishCrawl(env: RadarEnv, runId: string, status: "ok" | "partial"): Promise<void> {
  const fails = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM source_runs WHERE run_id = ? AND status = 'fail'`,
  )
    .bind(runId)
    .first<{ n: number }>();
  const finalStatus = (fails?.n ?? 0) > 0 ? "partial" : status;
  await env.DB.prepare(
    `UPDATE jobs SET status = ?, finished_at = datetime('now') WHERE run_id = ? AND kind = 'crawl' AND status = 'running'`,
  )
    .bind(finalStatus, runId)
    .run();
}
