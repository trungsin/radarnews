export type CsrGraph = {
  labels: string[];
  neighbors: number[][];
  weights: number[][];
};

export function encodeCsr(graph: CsrGraph): ArrayBuffer {
  const n = graph.labels.length;
  let nEdges = 0;
  for (const row of graph.neighbors) nEdges += row.length;
  const header = 4 + 4 + 4;
  const offsetsBytes = (n + 1) * 8;
  const neighBytes = nEdges * 4;
  const weightBytes = nEdges * 4;
  const buf = new ArrayBuffer(header + offsetsBytes + neighBytes + weightBytes);
  const view = new DataView(buf);
  let o = 0;
  view.setUint32(o, 0x31525343, true);
  o += 4;
  view.setUint32(o, n, true);
  o += 4;
  view.setUint32(o, nEdges, true);
  o += 4;
  let cursor = 0;
  for (let i = 0; i <= n; i++) {
    view.setBigUint64(o, BigInt(cursor), true);
    o += 8;
    if (i < n) cursor += graph.neighbors[i].length;
  }
  for (let u = 0; u < n; u++) {
    for (const v of graph.neighbors[u]) {
      view.setUint32(o, v, true);
      o += 4;
    }
  }
  for (let u = 0; u < n; u++) {
    for (const w of graph.weights[u]) {
      view.setFloat32(o, w, true);
      o += 4;
    }
  }
  return buf;
}

export function undirectedGraph(pairs: Array<{ a: string; b: string; w: number }>): CsrGraph {
  const index = new Map<string, number>();
  const labels: string[] = [];
  const add = (id: string) => {
    let i = index.get(id);
    if (i === undefined) {
      i = labels.length;
      index.set(id, i);
      labels.push(id);
    }
    return i;
  };
  for (const p of pairs) {
    add(p.a);
    add(p.b);
  }
  const neighbors: number[][] = labels.map(() => []);
  const weights: number[][] = labels.map(() => []);
  for (const p of pairs) {
    const u = add(p.a);
    const v = add(p.b);
    if (u === v) continue;
    neighbors[u].push(v);
    weights[u].push(p.w);
    neighbors[v].push(u);
    weights[v].push(p.w);
  }
  return { labels, neighbors, weights };
}
