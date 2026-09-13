---
title: "radar-content-leiden"
description: "Daily public AI/Agent radar: sharded CF crawl, D1+R2 graph, native Leiden, $0 Gemini extracts, one-question digest."
status: pending
priority: P1
effort: 4d
tags: [feature, infra, backend, database, frontend]
blockedBy: []
blocks: []
created: 2026-09-13
---

# radar-content-leiden

## Overview

Homegrown daily radar on Cloudflare **Paid** (confirmed). Crawl public AI/Agent sources, build an entity–document graph, partition with **Leiden** (`leiden-rs` 0.8.1 native binary via GH Action), score heat without LLM, extract with Gemini **3.6 first** (3.8 when free RPD proven) on survivors only, answer one question on Assets:

*Giới nghiên cứu và ứng dụng AI/Agent đang có gì thú vị, và đang dịch chuyển về hướng nào?*

Direction **B** (brainstorm). Leiden does not run in the 128 MB isolate. Claude/Codex use `wrangler d1` views only.

## Scope Challenge

- Existing code: none. Screenshots in `docs/` + brainstorm `plans/reports/brainstorm-260913-1212-radar-content-leiden.md`.
- Requested scope (HOLD): crawl → filter → graph → Leiden → score → D1 → Gemini survivors → one digest + wrangler views.
- Not in scope: four-tab clone, paid LLM, paid X API, WASM Leiden, per-post Gemini.
- Mode: **hard**.

## Cross-Plan Dependencies

None.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Sharded public crawl under 15 min/invocation, `ok|partial` jobs | P1 |
| 2 | D1 items + R2 CSR + native Leiden writeback with freshness guard | P1 |
| 3 | Public heat, Gemini extracts on survivors, $0 | P1 |
| 4 | One-question digest + wrangler agent views | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Infra and schema](./phase-01-start.md) | Pending |
| 2 | [Sharded public crawl](./phase-02-sharded-public-crawl.md) | Pending |
| 3 | [Graph Leiden heat](./phase-03-graph-leiden-heat.md) | Pending |
| 4 | [Digest and extracts](./phase-04-digest-and-extracts.md) | Pending |

## Architecture

```
Cron 00:00 UTC → Workflow crawl (no waitForEvent)
  → Queue non-arXiv (batch 6, concurrency 1) + serial arXiv step
  → D1 documents UNIQUE(run_day, content_hash), refresh interactions
  → source_runs idempotent drain
  → R2 CSR pointer
  → native leiden-run (separate job, 20 min timeout)
  → stable_key Jaccard alignment
  → heat.v1 → Gemini 3.6→3.8-when-proven cap 8/3
  → Assets /digest/{run_day}
  → sql/agent-selects/*.sql
```

## Key decisions

| Decision | Why |
|---|---|
| Workers Paid | Free 10 ms CPU; crawl 23–28 min |
| Queue shard, not one Cron | 15 min wall |
| D1 = items/scores/membership; R2 = CSR | D1 not a graph engine; Workflow step result 1 MiB |
| Native `leiden-run` crate | docs.rs 0.8.1 has no CLI/wasm |
| Public heat, not X interactions | No paid social API |
| Gemini community-level | Free RPD unpublished; per-post dies |
| Workers Assets digest | One deploy; Pages optional later |

## Research

- [Brainstorm](../reports/brainstorm-260913-1212-radar-content-leiden.md)
- [CF pipeline](../reports/researcher-01-cloudflare-pipeline.md)
- [Leiden/Gemini/sources](../reports/researcher-02-leiden-gemini-sources.md)

## Success Criteria

- [ ] Daily crawl completes `ok` or `partial`; never stuck `running`
- [ ] Leiden `algo='leiden'` or leiden job `partial` (not silent stale)
- [ ] Heat zero-LLM; Gemini survivors only; 3.6 first; 429 → pending; heat-only digest still 200
- [ ] Digest answers the one question; shift uses `stable_key` not Leiden ints
- [ ] Agent queries are `--file` SQL only
- [ ] No paid model in online path; `GEMINI_API_KEY` is a Worker secret

## Dependencies

- Cloudflare Workers Paid + D1 + R2 + Queues + Workflows
- Gemini API key (free Flash)
- Rust toolchain for `crates/leiden-run`
- Public source allowlist (HN, HF, GitHub, arXiv, RSS, Bluesky)

## Unresolved

1. Actual `LeidenConfig` fields in 0.8.1 (spike in phase 3).
2. Confirm Wrangler Workflows schema (`wrangler.jsonc`).
3. GitHub remote does not exist yet — cook must `git init` + create repo for Actions.

## Red Team Review

### Session — 2026-09-13
**Findings:** 15 unique (13 accepted, 2 rejected)
**Severity accepted:** 6 Critical, 7 High/Med

| # | Finding | Sev | Disposition | Applied |
|---|---------|-----|-------------|---------|
| 1 | Global unique hash freezes items/interactions | Crit | Accept | P1+P2 |
| 2 | Leiden ids incomparable across days | Crit | Accept | P3 `stable_key` |
| 3 | Redelivery double-counts drain | Crit | Accept | P1 `source_runs` |
| 4 | DLQ has no consumer | Crit | Accept | P1+P2 DLQ consumer |
| 5 | waitForEvent no timeout | Crit | Accept | P3 separate leiden job |
| 6 | SSRF via story URLs | Crit | Accept | P2 API-only fetch |
| 7 | Writeback SQL interpolation | High | Accept | P3 bound params |
| 8 | Prompt injection + XSS + `--remote` SQL | High | Accept | P4 markers, escape, `--file` |
| 9 | Public run_id oracle | Med | Reject | personal radar; run_day stays |
| 10 | 767 serial 1h budget | Med | Reject | v1 is API allowlist not 767 X accounts |
| 11 | Unscoped tokens | High | Accept | P1/P3 scoped CF token |
| 12 | R2 public access unverified | High | Accept | P1 success criterion |
| 13 | Partial crawls as regime shift | High | Accept | P3 views skip partial baselines |
| 14 | leiden-rs API invented | High | Accept | P3 compile spike |
| 15 | MAX_EXTRACTS 12 vs 3 | Med | Accept | P4 cap 8 then 3 |

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-start.md, phase-02, phase-03, phase-04
- Decision deltas: unique(run_day,hash); source_runs; no waitForEvent; stable_key; API-only fetch; bound writeback; extract cap 8/3
- Unresolved contradictions: 0

## Validation Log

### Session 1 — 2026-09-13
**Trigger:** user chose `/ak:plan validate` after red-team
**Questions asked:** 4

#### Questions & Answers

1. **[Assumptions]** Who runs native leiden-run after CSR lands on R2? Crawl Workflow will not wait.
   - Options: GH Action + scoped CF token | Laptop / wrangler after 07:00 | Heat-only until operator exists
   - **Answer:** GH Action + scoped CF token
   - **Rationale:** daily Leiden cannot depend on a human; needs a GitHub remote

2. **[Assumptions]** Free RPD for gemini-3.8-flash is unpublished. Which model starts the cascade?
   - Options: 3.6 first | 3.8 first | Heat-only until RPD screenshot
   - **Answer:** 3.6 first, try 3.8 when free quota proven
   - **Rationale:** $0 constraint; 3.8 may 403 on free

3. **[Tradeoffs]** GitHub search 10 req/min unauth vs token.
   - Options: No token in v1 | Optional GITHUB_TOKEN now
   - **Answer:** No token in v1
   - **Rationale:** small allowlist; shrink query on 403

4. **[Risks]** Is the Cloudflare account already Paid?
   - Options: Yes Paid | Not yet block cook
   - **Answer:** Yes, Paid
   - **Rationale:** hard floor already in plan

#### Confirmed Decisions
- Leiden runner: GitHub Action + CF token scoped to this D1+R2
- Gemini cascade: `gemini-3.6-flash` first; enable 3.8 via config when RPD proven
- GitHub API: unauthenticated v1
- Cloudflare: Paid confirmed — cook unblocked on that axis

#### Action Items
- [x] Flip Gemini order in plan + phase 4
- [x] Specify `.github/workflows/leiden-writeback.yml` in phase 3
- [x] Remove GITHUB_TOKEN from v1 crawl
- [x] Note git/GitHub remote as cook prerequisite

#### Impact on Phases
- Phase 1: git init + GitHub repo before Actions
- Phase 2: unauth GitHub only
- Phase 3: GH Action dispatch after CSR
- Phase 4: 3.6-first cascade

### Verification Results
- Claims checked: 0 this session (Red Team Review already present; no `[UNVERIFIED]` tags)
- Verified: 0 | Failed: 0 | Unverified: 0
- Tier: Standard (skipped per guard)

### Whole-Plan Consistency Sweep
- Files reread after propagation
- Decision deltas: GH Action Leiden; Gemini 3.6-first; no GITHUB_TOKEN; Paid confirmed
- Unresolved contradictions: 0

<!-- Updated: Validation Session 1 - cascade, runner, token, paid -->
