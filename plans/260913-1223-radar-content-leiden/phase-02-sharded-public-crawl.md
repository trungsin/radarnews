---
phase: 2
title: "Sharded public crawl"
status: todo
priority: P1
effort: 8h
dependencies: [1]
---

# Phase 2: Sharded public crawl

## Overview

Workflow enqueues one message per allowlisted source. Queue consumer fetches with max 6 connections, dedups by content hash, upserts `documents`, marks job `ok|partial`. No LLM. No X/Twitter.

## Context Links

- Depends on [Infra](./phase-01-start.md)
- Research: [CF pipeline](../reports/researcher-01-cloudflare-pipeline.md), [sources](../reports/researcher-02-leiden-gemini-sources.md)

## Requirements

- Functional: daily run fetches HN, HF Hub, GitHub search, arXiv, RSS, Bluesky public AppView; stores raw-enough fields for heat; per-source errors do not kill the run.
- Non-functional: each consumer invocation <15 min wall; ≤6 outbound waits; ≤1000 D1 queries/invocation; at-least-once safe.

## Architecture

```
scheduled → refuse if a crawl job already running for run_day
  insert jobs kind=crawl status=running
  insert source_runs pending for each enabled source
  CRAWL_QUEUE.sendBatch (non-arXiv)
  Workflow serial arXiv pages with step.sleep 3s
Workflow.do("await-drain")  // COUNT source_runs pending = 0 or timeout 50 min → partial
consumer:
  fetch ONLY allowlisted API/RSS endpoints (never follow item story URLs)
  upsert documents ON CONFLICT(run_day, content_hash) DO UPDATE interactions
  UPDATE source_runs SET status='ok'|'fail'  -- idempotent
DLQ consumer: source_runs.status='fail'; jobs.notes += source_id; jobs.status=partial
```

Allowlist file `src/crawl/allowlist.json` — start with **public APIs**, not 767 X accounts. Seed:

- HN Algolia `search_by_date` tags story, query AI/LLM/agent
- HF `/api/models?sort=trending&limit=100` + papers if OpenAPI stable
- GitHub `GET /search/repositories?q=agent+OR+llm&sort=updated`
- arXiv `search_query=all:agent+OR+all:LLM` (1 req / 3s — dedicated slow shard)
- Bluesky `app.bsky.feed.searchPosts?q=AI agent`
- RSS list of lab blogs (OpenAI, Anthropic, DeepMind, HF blog)

Do not scrape X. Do not invent 30K interaction counts. Store whatever public integer exists (`points`, `stargazers_count`, `likes`, `likeCount`) in `documents.interactions` as **raw source units**, not a unified fake.

## Related Code Files

- Create: `src/crawl/allowlist.json`
- Create: `src/crawl/types.ts`
- Create: `src/crawl/fetch-source.ts`
- Create: `src/crawl/adapters/{hn,hf,github,arxiv,bluesky,rss}.ts`
- Create: `src/crawl/consumer.ts`
- Modify: `src/index.ts` queue handler
- Modify: `src/workflow.ts` enqueue + drain
- Modify: `migrations/` if `sources` needs seed insert

## Implementation Steps

1. Seed `sources` from allowlist.json (idempotent). v1 source count is these API endpoints + RSS list, **not** 767 X accounts.
2. Message schema `{ run_id, run_day, source_id }` only. No bodies.
3. Consumer `max_batch_size=6`, `max_concurrency=1`. Per message: timeout 20s. http/https only.
4. Adapters return `{ url, title, published_at, author, interactions, platform, raw_excerpt }` from the **API JSON/RSS**, not a second fetch of the story URL. `raw_excerpt` = title + snippet fields already in the API payload.
5. `content_hash = sha256(canonical_url + published_at + title)`. UNIQUE `(run_day, content_hash)`. Upsert **refreshes `interactions`**. Same hash yesterday is a new row today.
6. GitHub: **no token in v1**. Unauth 10 req/min; shrink query on 403. Do not add `GITHUB_TOKEN`.
<!-- Updated: Validation Session 1 - no GITHUB_TOKEN -->
7. arXiv: **not** on CRAWL_QUEUE. Workflow step pages with `step.sleep('3 seconds')`, 1 connection. Cap pages so the step stays well under 15 min CPU/wall.
8. Failures: retry then DLQ. DLQ **consumer** marks `source_runs` fail and job `partial`. Drain uses `source_runs`, never a monotonically incremented counter.
9. Drain timeout 50 min → `partial` even if pending remain. Never leave `running`.
10. Smoke: one HN message → documents row; redelivery does not double-count `source_runs`.

## Todo

- [ ] allowlist.json + sources seed
- [ ] six adapters
- [ ] consumer upsert + hash dedup
- [ ] Workflow enqueue + drain
- [ ] DLQ → partial
- [ ] arXiv 3s spacing
- [ ] smoke one source end-to-end

## Success Criteria

- [ ] 1+ document from each enabled source kind in a local run
- [ ] Same-day redelivery does not duplicate documents or source_runs ok rows
- [ ] Cross-day recrawl updates `interactions` and a new `run_day` row
- [ ] Killing one source leaves others `ok` and job `partial`
- [ ] No invocation holds >6 fetches
- [ ] No X client code; no fetch of arbitrary story URLs

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| Source 429 storm | many DLQ | backoff, disable source, partial |
| GitHub 10/min | incomplete_results | shrink query; no token in v1 |
| 767-account screenshot not reproduced | fewer docs | expected; public allowlist is the contract |
| 15 min wall still hit | consumer timeout | drop max_batch_size to 3 |

If a source ToS forbids bots: **remove adapter**, do not scrape.

## Security Considerations

- Adapters fetch allowlisted API/RSS endpoints only. **Never** follow HN/RSS/GitHub item target URLs (SSRF).
- Cap body 1 MiB. No eval of fetched JS. Scheme http/https only.
- No `GITHUB_TOKEN` in v1.
- Store API snippets, not HTML dumps, in D1. Optional R2 raw of the API payload only.
