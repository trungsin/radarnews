# Cloudflare pipeline research (2026)

## Scope and conclusion

Official Cloudflare documentation reviewed 2026-09-13 for Direction B: ~767 allowlisted source fetches, D1 item/community state, binary CSR in R2, native Leiden writeback, Gemini only on survivors, one-question digest.

Workers Paid required. Split: background Worker owns Cron, Workflow, Queue, D1, R2, Gemini. Digest UI via Workers Assets on same Worker (one deploy) or separate Pages project. Do not mix `pages_build_output_dir` into the pipeline Worker.

Leiden does **not** run in the isolate. `cpu_ms` raise is for crawl/filter/CSR serialize only.

## 1. Minimal wrangler sketch

Cloudflare recommends `wrangler.jsonc` for new projects; TOML still supported.

```toml
name = "radarnews-pipeline"
main = "src/index.ts"
compatibility_date = "2026-09-04"
workers_dev = false

[assets]
directory = "./public"
binding = "ASSETS"

[triggers]
crons = ["0 0 * * *"]

[limits]
cpu_ms = 300000

[[d1_databases]]
binding = "DB"
database_name = "radarnews"
database_id = "<D1_DATABASE_ID>"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "CSR_BUCKET"
bucket_name = "radarnews-csr"

[[queues.producers]]
binding = "CRAWL_QUEUE"
queue = "radarnews-crawl"

[[queues.consumers]]
queue = "radarnews-crawl"
max_batch_size = 6
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "radarnews-crawl-dlq"
max_concurrency = 1

[[workflows]]
binding = "RADAR_WORKFLOW"
name = "radarnews-daily"
class_name = "RadarWorkflow"
```

Sources: https://developers.cloudflare.com/workers/wrangler/configuration/ https://developers.cloudflare.com/queues/configuration/configure-queues/ https://developers.cloudflare.com/workers/static-assets/

## 2. Shard 767 fetches

- One Queue message per source: `{run_day, run_id, source_id, url}`.
- `max_batch_size = 6` matches 6 simultaneous connections. `max_concurrency = 1` stops autoscaling from multiplying that.
- 767 sources → ≥128 consumer batches. 23–28 min crawl cannot fit one 15 min Cron/Queue invocation.
- Workflow tracks durable run row; waits/retries; does not assume one consumer drains the queue.
- Per-fetch timeout; partial ack; DLQ; idempotent `(run_id, source_id, content_hash)`.

Sources: https://developers.cloudflare.com/queues/platform/limits/ https://developers.cloudflare.com/workers/platform/limits/

## 3. D1

```sh
npx wrangler d1 migrations apply radarnews --local
npx wrangler d1 execute radarnews --remote --file=./sql/agent-views.sql
npx wrangler d1 execute radarnews --remote --command='SELECT * FROM v_anomaly LIMIT 50;'
```

Limits: 100 bind params, 1000 queries/invocation, 6 D1 conns, 100 KB SQL, 2 MB row, 30s query, single-thread.

Chunk inserts: if 10 binds/row → max 10 rows per multi-row statement. Prefer `db.batch()` of prepared singles in 100–300 statement chunks.

Sources: https://developers.cloudflare.com/d1/platform/limits/ https://developers.cloudflare.com/workers/wrangler/commands/d1/

## 4. R2 CSR

Key `runs/${runDay}/${runId}/graph.csr`. `put` ArrayBuffer. Workflow `step.do()` returns only `{key, etag, runId}` — never the graph (1 MiB step result cap).

Sources: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ https://developers.cloudflare.com/workflows/reference/limits/

## 5. Digest cache

Stable URL `/digest/${runDay}`. `caches.default` + Cache-Control + ETag. Cache API is colo-local; D1/R2 are source of truth. Cache Reserve is zone config, not a Worker binding.

Sources: https://developers.cloudflare.com/workers/runtime-apis/cache/

## 6. Secrets

`npx wrangler secret put GEMINI_API_KEY`. Local `.dev.vars` gitignored. Never in D1, R2 metadata, Queue messages, logs.

Source: https://developers.cloudflare.com/workers/configuration/secrets/

## Failure modes

| Failure | Mitigation |
|---|---|
| 23–28 min vs 15 min wall | Queue shard; Workflow resume |
| Queue autoscaling | `max_concurrency = 1` |
| Duplicate inserts | unique `(run_id, source_id, content_hash)` |
| CSR in Workflow result | R2 pointer only |
| Stale digest | versioned URL + TTL |
| Gemini 429 | survivor-only, cascade, defer |

## Unresolved

1. Paid-account Queue concurrency after deploy.
2. Cache Reserve eligibility for zone.
3. Empirical per-source timeout.
4. Confirm installed Wrangler schema for Workflows/Assets (`wrangler.jsonc` vs toml).
