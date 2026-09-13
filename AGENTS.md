# AGENTS.md

Shared context for **OMP (primary)** and **Google Antigravity (backup/failover)**.
OMP reads this natively; Antigravity reads it as human-readable context. **No secrets here.**

## PROJECT
`radarnews-pipeline` — a news pipeline on **Cloudflare Workers** (Wrangler), backed by
**D1** (`migrations/`, `sql/`). TypeScript worker in `src/`; native code in `crates/`.
Config: `wrangler.jsonc`. Secrets live in `.dev.vars` (gitignored) — template `.dev.vars.example`.

## CURRENT GOAL
<edit me — what you're building next>

## ARCHITECTURE (agent stack)
```
USER → AgentKit (skills/workflows) → OMP PRIMARY
        ├─ Claude  (PLAN,   plan role)
        ├─ Grok    (CRITIC, default/driver role)
        └─ GPT     (EXECUTE, implementer/tester = gpt-6-astra)
        → review (Claude) → RESULT

BACKUP PATH (manual failover, OMP unavailable):
  preserve git state → refresh AGENTS.md → Google Antigravity → continue work
```
- No project `.omp/config.yml` → inherits GLOBAL routing (default=grok-4.6, plan=Claude,
  EXECUTE=gpt-6-astra via agent overrides). Do not add an override unless intentionally diverging.
- Auto runtime fallback → `google-antigravity` provider configured globally. Antigravity **IDE**
  is the *manual* failover.

## IMPORTANT CONSTRAINTS
- One agent edits the working tree at a time. Parallel → `git worktree add ../radarnews-agy`.
- No secrets in this file, in git, or in Vite/Wrangler env. `.dev.vars` stays gitignored.
- OMP and Antigravity credentials are independent — never share keys/tokens/cookies.
- Antigravity default is REVIEW-ONLY as second opinion; edits only when asked.

## HANDOFF PROCEDURE
- `omp-handoff status` — git state before switching.
- `omp-handoff to-agy ["note"]` — snapshot + refresh this file + open in Antigravity.
- `omp-handoff to-omp ["note"]` — snapshot + refresh, then continue in `omp`.

## COMPLETED
- <edit me>

## REMAINING
- <edit me>

## KNOWN ISSUES
- <edit me>

## TEST STATUS
- Not run this session. Dev: `npm run dev` (wrangler); D1: `npm run migrate:local`.

<!-- HANDOFF:auto:start -->
## HANDOFF (auto) — 2026-09-13 16:57
- Branch: `main`
- Goal: verify radarnews backup path
- Staged: 0 file(s)
- Unstaged: 0 file(s)
- Untracked: 48 file(s)
- Fill in: COMPLETED / REMAINING / KNOWN ISSUES / TEST STATUS
<!-- HANDOFF:auto:end -->
