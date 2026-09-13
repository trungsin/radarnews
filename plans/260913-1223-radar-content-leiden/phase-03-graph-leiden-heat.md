---
phase: 3
title: "Graph Leiden heat"
status: todo
priority: P1
effort: 8h
dependencies: [2]
---

# Phase 3: Graph Leiden heat

## Overview

Build entity–document graph from crawled items, write CSR to R2, run **native** `leiden-rs` 0.8.1 via `crates/leiden-run`, write `community_id` back, compute **public** heat with zero LLM. Freshness guard: missing Leiden → job `partial`.

## Context Links

- Depends on [Crawl](./phase-02-sharded-public-crawl.md)
- Research: [Leiden](../reports/researcher-02-leiden-gemini-sources.md)

## Requirements

- Functional: CSR in R2; Leiden partition in D1 `algo='leiden'`; heat on communities; 8–40 movements typical.
- Non-functional: Leiden outside isolate; Workflow step returns `{key,etag}` only; operator/CI can run binary without Workers memory.

## Architecture

**Nodes:** document, entity (project/model/person/org), source. Not keywords.

**Edges:** MENTIONS, DERIVES_FROM, REFERENCES, SAME_AS, CO_MENTION (salient entities only). Undirected projection for Leiden. Down-weight source/author stars.

**CSR v1** (R2 `runs/{run_day}/{run_id}/graph.csr`):

```
u32 magic 'CSR1'
u32 n_nodes
u32 n_edges
u64[] offsets  // n+1
u32[] flat_neighbors
f32[] weights
```

Sidecar JSON `graph.meta.json`: dense_id → `{node_type, node_id}`.

**leiden-run** (Rust, pin `leiden-rs = "=0.8.1"`):

Blocking spike **before** CSR format: compile crate, print `LeidenConfig` fields. If CPM/gamma/seed exist, expose CLI flags. If not, use whatever quality function the crate actually has; still Leiden, never Louvain. Record the real API in this phase's notes.

```
leiden-run --csr graph.csr --quality cpm --gamma 1.0 --seed 42 --out assignment.json
```

`assignment.json`: `{ quality, membership: [{dense_id, community}] }`.

Writeback: D1 HTTP or wrangler **bound params only**. Never string-interpolate entity names into `--command`.

**stable_key:** after partition, hash of sorted top-8 entity canonical names in the community. Match yesterday's community by max Jaccard of entity sets (threshold 0.4). `v_anomaly`/`v_trending` join on `stable_key`, not Leiden integer id.

**Heat** (formula version `heat.v1`, persist on `scores`):

```
age_h = max(1, hours_since_publish)
velocity = log1p(interactions) / (age_h+2)^0.65
source_heat = clamp(velocity / P95_in_source, 0, 3)
heat = 0.65*mean(source_heat) + 0.20*log1p(distinct_sources) + 0.15*novelty
```

Normalize per source/day. Community heat = size-weighted mean of member docs. Rank. Threshold analogue 55 → start at **top-N or heat ≥ mean+1σ**; persist threshold in jobs.notes. Do not fake X-scale totals.

**Freshness:** crawl Workflow **does not** `waitForEvent`. It finishes `ok|partial` when drain ends. Leiden is a **separate** `jobs.kind=leiden` started by **GitHub Action** (`.github/workflows/leiden-writeback.yml`) on `repository_dispatch` from crawl-complete (Worker calls GitHub API with a repo dispatch token) **or** `workflow_dispatch`. Timeout 20 min: if no membership, `leiden` job `partial`, `notes='leiden-missing'`. Digest keys off latest crawl for `run_day` with status in (`ok`,`partial`). One crawl per run_day.
<!-- Updated: Validation Session 1 - GH Action runner -->

## Related Code Files

- Create: `src/graph/extract-entities.ts`
- Create: `src/graph/build-csr.ts`
- Create: `src/graph/heat.ts`
- Create: `src/graph/r2.ts`
- Create: `crates/leiden-run/Cargo.toml`, `crates/leiden-run/src/main.rs`
- Create: `scripts/leiden-writeback.ts`, `.github/workflows/leiden-writeback.yml`
- Modify: `src/workflow.ts` add build-csr step (pointer only)
- Modify: `sql/agent-views.sql` real `v_anomaly`, `v_trending`

## Implementation Steps

1. **Spike:** `cargo build -p leiden-run` against 0.8.1; document actual Config API. Fail closed only if the crate cannot partition a 100-node graph.
2. Entity extract **without LLM**: API ids only (GitHub full_name, HF id, arXiv id). Store MENTIONS.
3. Workflow step `build-csr` after crawl drain (same instance, no Leiden wait): page D1; R2 put; return `{key,etag,n_nodes,n_edges}` only.
4. `scripts/leiden-writeback.ts` + GH Action: R2 get → leiden-run → parameterized INSERTs. Then heat SQL. Then `jobs.kind=leiden` ok. Secrets: `CLOUDFLARE_API_TOKEN` scoped to this D1+R2 only. `GITHUB_DISPATCH_TOKEN` on the Worker is **contents:none, only repo dispatch** — not a CF god token.
5. `stable_key` + Jaccard match to previous `run_day` where that day's crawl `status='ok'` (skip `partial` baselines).
6. Views:
   - `v_anomaly`: heat z vs previous **ok** run_day on `stable_key`; include `baseline_status`
   - `v_trending`: 7-day heat delta on `stable_key`; flag if any day in window was `partial`
7. Smoke: fixture CSR → membership covers all nodes.
8. Calibrate gamma on first real graph if API allows; else accept crate default and record community count.

## Todo

- [ ] entity extract + edges
- [ ] CSR v1 + R2 put/get
- [ ] crates/leiden-run
- [ ] writeback + freshness guard
- [ ] heat.v1
- [ ] v_anomaly v_trending
- [ ] fixture smoke

## Success Criteria

- [ ] After writeback, `SELECT algo FROM communities` is `leiden`
- [ ] `communities.run_id` equals that day's crawl `run_id` or leiden job is `partial`
- [ ] `v_trending` joins `stable_key`, not raw Leiden ids
- [ ] Heat uses only public integer fields + graph structure
- [ ] Workflow never returns CSR bytes from `step.do`
- [ ] `leiden-run --help` works on laptop; writeback uses bound params
- [ ] R2 public access remains off

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| leiden-rs API mismatch vs docs.rs | compile fail | pin 0.8.1; read crate source; adjust builder only |
| Gamma → 1 community or 2000 | size histogram | retune CPM gamma; do not fall back to Louvain |
| Operator forgets writeback | freshness guard | job partial; digest shows "Leiden pending" |
| CSR OOM in Worker | isolate 128 MB | stream/chunk build; if still OOM, build CSR in the native binary from NDJSON export instead — **adjust within plan**, still no WASM |

If `leiden-rs` cannot read our CSR: change the binary to ingest `edges.tsv`. Do not switch algorithm.

## Security Considerations

- Writeback: wrangler/D1 HTTP with bound params. No public membership POST.
- R2 CSR not public; verify bucket public access disabled after create.
- Entity names from public API ids only.
- CI CF token: this database + this bucket only.
