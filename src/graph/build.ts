import type { RadarEnv } from "../env";
import { encodeCsr, undirectedGraph } from "./csr";

type DocRow = {
  id: string;
  platform: string;
  url: string;
  title: string;
  source: string;
};

function entityId(kind: string, name: string): string {
  return `ent:${kind}:${name.toLowerCase()}`;
}

export async function buildAndStoreCsr(
  env: RadarEnv,
  runId: string,
  runDay: string,
): Promise<{ key: string; n_nodes: number; n_edges: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, platform, url, title, source FROM documents WHERE run_day = ?`,
  )
    .bind(runDay)
    .all<DocRow>();
  const pairs: Array<{ a: string; b: string; w: number }> = [];
  for (const doc of results ?? []) {
    const docNode = `doc:${doc.id}`;
    pairs.push({ a: docNode, b: `src:${doc.source}`, w: 0.05 });
    if (doc.platform === "github" && doc.title.includes("/")) {
      pairs.push({ a: docNode, b: entityId("repo", doc.title), w: 1 });
    } else if (doc.platform === "hf" && doc.title.includes("/")) {
      pairs.push({ a: docNode, b: entityId("model", doc.title), w: 1 });
    } else {
      try {
        const host = new URL(doc.url).host;
        if (host) pairs.push({ a: docNode, b: entityId("host", host), w: 0.5 });
      } catch {
        /* ignore bad url */
      }
    }
  }
  const graph = undirectedGraph(pairs);
  const buf = encodeCsr(graph);
  const key = `runs/${runDay}/${runId}/graph.csr`;
  await env.CSR_BUCKET.put(key, buf, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { run_id: runId, format: "csr-v1" },
  });
  const metaKey = `runs/${runDay}/${runId}/graph.meta.json`;
  await env.CSR_BUCKET.put(metaKey, JSON.stringify({ labels: graph.labels, runId, runDay }));
  let nEdges = 0;
  for (const row of graph.neighbors) nEdges += row.length;
  return { key, n_nodes: graph.labels.length, n_edges: nEdges };
}
