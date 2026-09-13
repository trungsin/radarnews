---
phase: 1
title: "Infra and schema"
status: todo
priority: P1
effort: 4h
dependencies: []
---

# Phase 1: Infra and schema

## Overview

Scaffold the Cloudflare Worker (Paid), D1 schema, R2 bucket, Queue+DLQ, Workflow, Assets stub, secrets, and local `wrangler d1` views. No crawl yet.

## Context Links

- Plan: [plan.md](./plan.md)
- Research: [CF pipeline](../reports/researcher-01-cloudflare-pipeline.md)
- Brainstorm: [B](../reports/brainstorm-260913-1212-radar-content-leiden.md)

## Requirements

- Functional: deployable Worker with bindings `DB`, `CSR_BUCKET`, `CRAWL_QUEUE`, `RADAR_WORKFLOW`, `ASSETS`; empty digest page; migrations apply local+remote.
- Non-functional: Workers Paid; `cpu_ms=300000`; no secrets in git; D1 queries indexed.

## Architecture

One Worker `radarnews-pipeline`. Cron `scheduled()` starts `RadarWorkflow`. Workflow is a no-op stub that writes a `jobs` row. Queue consumer stub acks. Assets serve `public/index.html`.

D1 is the document/score store. R2 holds CSR later. Never put graph blobs in D1 rows or Workflow step results.

## Related Code Files

- Create: `wrangler.jsonc`
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `src/index.ts`, `src/workflow.ts`
- Create: `migrations/0001_init.sql`
- Create: `sql/agent-views.sql`
- Create: `.dev.vars.example`
- Create: `public/index.html`

## Implementation Steps

1. `git init` + GitHub remote (required for Leiden Action). `npm init` + wrangler TypeScript Worker. `compatibility_date` ≥ 2026-09-04.
<!-- Updated: Validation Session 1 - git remote -->
2. Bindings (names frozen):

```jsonc
{
  "name": "radarnews-pipeline",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-04",
  "assets": { "directory": "./public", "binding": "ASSETS" },
  "triggers": { "crons": ["0 0 * * *"] },
  "limits": { "cpu_ms": 300000 },
  "d1_databases": [{ "binding": "DB", "database_name": "radarnews", "migrations_dir": "migrations" }],
  "r2_buckets": [{ "binding": "CSR_BUCKET", "bucket_name": "radarnews-csr" }],
  "queues": {
    "producers": [{ "binding": "CRAWL_QUEUE", "queue": "radarnews-crawl" }],
    "consumers": [
      {
        "queue": "radarnews-crawl",
        "max_batch_size": 6,
        "max_batch_timeout": 5,
        "max_retries": 3,
        "dead_letter_queue": "radarnews-crawl-dlq",
        "max_concurrency": 1
      },
      {
        "queue": "radarnews-crawl-dlq",
        "max_batch_size": 6,
        "max_retries": 0
      }
    ]
  },
  "workflows": [{ "binding": "RADAR_WORKFLOW", "name": "radarnews-daily", "class_name": "RadarWorkflow" }]
}
```

3. Create D1 + R2 + queues via wrangler. Put IDs into config. `wrangler secret put GEMINI_API_KEY` (placeholder ok until phase 4).
4. Migration tables:

- `documents` (id, source, platform, url, title, published_at, fetched_at, content_hash, interactions INTEGER, run_id, run_day, status). UNIQUE `(run_day, content_hash)`. Same item may exist on many days; upsert refreshes `interactions`.
- `entities` (id, type, canonical_name, first_seen, last_seen)
- `edges` (id, src_id, src_type, dst_id, dst_type, edge_type, weight, run_day)
- `communities` (id, run_day, run_id, algo, resolution, size, label_vi, heat, rank, stable_key)
- `node_communities` (node_id, node_type, community_id, run_day) PK
- `scores` (id, subject_type, subject_id, run_day, metric, value, weight, composite)
- `extracts` (id, scope, scope_id, model, question, insight, evidence_json, counter, token_cost, created_at)
- `jobs` (id, kind, run_id, run_day, started_at, finished_at, status, items, wall_ms, gemini_rpd_used, notes). At most one `kind=crawl` row per `run_day` in status running.
- `sources` (id, kind, url, enabled, last_ok_at, last_error)
- `source_runs` (run_id, source_id, status, items, updated_at) PK — idempotent drain. Redelivery updates this row, does not increment blindly.

Indexes: `documents(run_day, content_hash)`, `edges(run_day)`, `communities(run_day, stable_key)`, `jobs(run_id)`, `source_runs(run_id, status)`.

5. Drain counts `SELECT COUNT(*) FROM source_runs WHERE run_id=? AND status='pending'`. Never increment a counter on redelivery.
6. `sql/agent-views.sql`: `v_anomaly`, `v_assumption`, `v_trending` as stubs (`SELECT 1 WHERE 0`) until phase 3–4 fill real definitions.
7. `src/index.ts`: `fetch` serves Assets; `scheduled` creates Workflow instance; `queue` handler logs+acks.
8. Smoke: `wrangler d1 migrations apply radarnews --local`; `wrangler dev`; Cron trigger writes a `jobs` row.

## Todo

- [x] wrangler.jsonc + package.json + tsconfig
- [ ] D1/R2/Queue/Workflow **remote** resources created
- [x] 0001_init.sql applied (--local)
- [x] agent-views.sql stub applied (--local)
- [x] .dev.vars.example (secret put remote still open)
- [x] scheduled writes jobs row (Workflow open-run)

## Success Criteria

- [ ] `wrangler deploy` succeeds on Paid account
- [x] local sqlite_master shows all tables
- [ ] Cron or wrangler deployments can start Workflow without throwing (not smoke-run)
- [x] No API keys in repo
- [ ] R2 bucket public access off (remote)
- [ ] D1 Time Travel enabled (remote)

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| Wrangler schema rejects workflows in jsonc | deploy error | switch documented toml fields; do not invent keys |
| Account is Free | 10 ms CPU / missing Queue | stop; Paid is a hard floor — replan if user refuses |
| D1 create fails | wrangler error | create via dashboard, paste database_id |

If Paid is unavailable: **stop and replan**. Do not fake crawl on Free.

## Security Considerations

- Secrets only via `wrangler secret` / `.dev.vars` gitignored
- D1 SQL views are not a permission boundary. Agents run only `sql/agent-selects/*.sql` files; never interpolate crawled strings into `--command`
- No public write API
- CF API token for CI scoped to this D1 + this R2 bucket only
