---
title: radarnews hard plan B
date: 2026-09-13
summary: Direction B plan + red-team patches
---

# radarnews hard plan B

## What happened
Hard-mode plan for radarnews Direction B. Empty repo. Scaffolded plans/260913-1223-radar-content-leiden via ak plan create. Red-team (security/failure/assumption) accepted 13 findings; patched unique(run_day,hash), source_runs, DLQ consumer, no waitForEvent, stable_key, API-only fetch, bound writeback, extract cap 8/3.

## Decision
Ship B: CF Paid crawl + D1/R2 + native leiden-rs 0.8.1 + Gemini survivors + one-question digest. Not four-tab clone. Not WASM Leiden.

## Next steps
Review plan then /ak:plan validate or /ak:cook. Repo has no git; ak plan use skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
