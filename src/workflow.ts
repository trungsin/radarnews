import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { RadarEnv } from "./env";
import { utcRunDay } from "./ids";
import { ingestSource } from "./crawl/consumer";
import {
  arxivSources,
  finishCrawl,
  openSourceRuns,
  pendingCount,
  queueMessages,
  seedSources,
} from "./crawl/seed";
import { buildAndStoreCsr } from "./graph/build";

export type RadarParams = {
  runDay?: string;
};

export class RadarWorkflow extends WorkflowEntrypoint<RadarEnv, RadarParams> {
  async run(event: WorkflowEvent<RadarParams>, step: WorkflowStep) {
    const runDay = event.payload.runDay ?? utcRunDay();
    const runId = event.instanceId;

    const opened = await step.do("open-run", async () => {
      const id = `job_${crypto.randomUUID()}`;
      const started = new Date().toISOString();
      const existing = await this.env.DB.prepare(
        `SELECT id FROM jobs WHERE kind = 'crawl' AND run_day = ? AND status = 'running' LIMIT 1`,
      )
        .bind(runDay)
        .first();
      if (existing) {
        return { skipped: true as const, runId, runDay };
      }
      await this.env.DB.prepare(
        `INSERT INTO jobs (id, kind, run_id, run_day, started_at, status, items, gemini_rpd_used)
         VALUES (?, 'crawl', ?, ?, ?, 'running', 0, 0)`,
      )
        .bind(id, runId, runDay, started)
        .run();
      await seedSources(this.env);
      await openSourceRuns(this.env, runId);
      return { skipped: false as const, jobId: id, runId, runDay };
    });

    if (opened.skipped) {
      return;
    }

    await step.do("enqueue", async () => {
      const msgs = queueMessages(runId, runDay);
      if (msgs.length > 0) {
        await this.env.CRAWL_QUEUE.sendBatch(msgs.map((body) => ({ body })));
      }
      return { queued: msgs.length };
    });

    for (const src of arxivSources()) {
      await step.sleep(`arxiv-gap-${src.id}`, "3 seconds");
      await step.do(`arxiv-${src.id}`, async () => {
        try {
          await ingestSource(this.env, { run_id: runId, run_day: runDay, source_id: src.id });
        } catch {
          await this.env.DB.prepare(
            `INSERT INTO source_runs (run_id, source_id, status, items, updated_at)
             VALUES (?, ?, 'fail', 0, datetime('now'))
             ON CONFLICT(run_id, source_id) DO UPDATE SET status = 'fail', updated_at = excluded.updated_at`,
          )
            .bind(runId, src.id)
            .run();
        }
        return { source_id: src.id };
      });
    }

    const deadline = Date.now() + 50 * 60 * 1000;
    let pending = await step.do("pending-0", () => pendingCount(this.env, runId));
    let tick = 0;
    while (pending > 0 && Date.now() < deadline) {
      await step.sleep(`drain-${tick}`, "30 seconds");
      pending = await step.do(`pending-${tick + 1}`, () => pendingCount(this.env, runId));
      tick += 1;
      if (tick > 100) break;
    }

    await step.do("finish", () => finishCrawl(this.env, runId, pending > 0 ? "partial" : "ok"));
    await step.do("build-csr", () => buildAndStoreCsr(this.env, runId, runDay));
  }
}
