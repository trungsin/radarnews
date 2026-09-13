# Radarnews Direction B — Leiden, public sources, Gemini
_Date: 2026-09-13_

## Executive summary

Pin `leiden-rs = 0.8.1`. Library API (`GraphDataBuilder` → `Leiden::run` → `partition`). **No documented CLI. No documented wasm feature.** We write a thin native binary `crates/leiden-run` that reads R2/local CSR, writes membership JSON. Native Leiden is outside Workers.

CPM with calibrated gamma for 8–40 movements. Gemini structured JSON on survivors only. Worker fetches sources; do not rely on URL Context for the hot path.

## 1. Leiden 0.8.1

https://docs.rs/leiden-rs/0.8.1/leiden_rs/

```rust
use leiden_rs::{GraphDataBuilder, Leiden, LeidenConfig};
let mut b = GraphDataBuilder::new(node_count);
b.add_edge(u, v, weight)?;
let graph = b.build()?;
let result = Leiden::new(LeidenConfig::default()).run(&graph)?;
// result.partition, result.quality
```

Quality: Modularity, CPM, RBConfiguration, RBER. Prefer **CPM** (avoids modularity resolution limit). Seeded config for reproducibility.

Map D1 node IDs → dense `[0..n)`, reverse map on writeback.

WASM: crate README claimed wasm; **docs.rs 0.8.1 does not document wasm/cli**. Treat Worker WASM as a later spike. v1 = native binary.

## 2. Public sources (no paid X)

| Source | Heat fields | Limits |
|---|---|---|
| HN Algolia `search_by_date` | points, num_comments, author, url | unofficial; backoff on 429 |
| HN Firebase item | score, descendants | official API claims no rate limit; still cap |
| HF Hub `/api/models?sort=trending` | likes, downloads, lastModified | HF-wide limits; honor headers |
| GitHub REST search repos | stargazers, forks, pushed_at, topics | auth 30 req/min search; unauth 10; 1000 results max |
| arXiv export API / RSS | recency only, no votes | 1 req / 3s, 1 connection; metadata CC0 |
| Bluesky public AppView searchPosts | like/repost/reply/quote counts | honor 429; cursor page |

Public heat [INFERENCE]:

```
age_h = max(1, hours_since_publish)
velocity = log1p(points + 2*reposts + replies) / (age_h+2)^0.65
source_heat = clamp(velocity / P95_source, 0, 3)
heat = 0.65*source_heat + 0.20*log1p(cross_source) + 0.15*novelty
```

Normalize per source/day so GitHub stars do not dominate. Persist raw counts + formula version.

## 3. Gemini extract schema

Model `gemini-3.8-flash` → 429 → `gemini-3.6-flash` once → pending.

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "question": {"type": "string", "minLength": 1},
    "insight": {"type": "string", "minLength": 1},
    "evidence": {
      "type": "array",
      "minItems": 3,
      "maxItems": 3,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "claim": {"type": "string"},
          "url": {"type": "string", "format": "uri"},
          "source": {"type": "string"}
        },
        "required": ["claim", "url", "source"]
      }
    },
    "counter": {"type": "string", "minLength": 1}
  },
  "required": ["question", "insight", "evidence", "counter"]
}
```

Worker fetches excerpts to R2; send excerpts, not live URL Context. Free tier content may train Google — public text only.

https://ai.google.dev/gemini-api/docs/structured-output
https://ai.google.dev/gemini-api/docs/rate-limits

## 4. Graph: movements not micro-topics

Nodes: `document`, `entity`, `source` (optional `author`). Not one node per keyword.

Edges (weighted, dated): MENTIONS, DERIVES_FROM, REFERENCES, AUTHORED_BY, SAME_AS, CO_MENTION (salient entities only).

Project undirected document/entity graph for Leiden. Down-weight source/author stars.

Keep 8–40 movements: CPM gamma, min community mass, multi-source required, merge high entity overlap.

## Unresolved

1. Confirm LeidenConfig setters (gamma, seed, iterations) against crate source.
2. HF Daily Papers schema unstable — probe staging.
3. Bluesky AppView quota empirical.
4. Freeze counts at ingest vs refresh — reproducibility.
5. Live AI Studio free RPD for 3.8 vs 3.6.
