import { RadarWorkflow } from "./workflow";
import type { RadarEnv } from "./env";
import { utcRunDay } from "./ids";
import { handleCrawlBatch, handleDlqBatch } from "./crawl/consumer";
import { handleDigest } from "./digest/handler";

export { RadarWorkflow };

function digestPath(pathname: string): string | null {
  const match = pathname.match(/^\/digest\/(\d{4}-\d{2}-\d{2})\/?$/);
  return match ? match[1] : null;
}

export default {
  async fetch(request: Request, env: RadarEnv): Promise<Response> {
    const url = new URL(request.url);
    const runDay = digestPath(url.pathname);
    if (runDay) {
      return handleDigest(env, runDay, url.searchParams.get("format") === "json");
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: RadarEnv, ctx: ExecutionContext): Promise<void> {
    const runDay = utcRunDay();
    ctx.waitUntil(
      env.RADAR_WORKFLOW.create({
        id: `crawl-${runDay}`,
        params: { runDay },
      }).catch(() => undefined),
    );
  },

  async queue(batch: MessageBatch<unknown>, env: RadarEnv): Promise<void> {
    if (batch.queue === "radarnews-crawl-dlq") {
      await handleDlqBatch(batch, env);
      return;
    }
    await handleCrawlBatch(batch, env);
  },
};
