import type { RadarEnv } from "../env";
import { escapeHtml } from "./html";

const QUESTION =
  "Giới nghiên cứu và ứng dụng AI/Agent đang có gì thú vị, và đang dịch chuyển về hướng nào?";

type CommunityRow = {
  stable_key: string | null;
  heat: number | null;
  label_vi: string | null;
  size: number | null;
  insight: string | null;
  evidence_json: string | null;
  counter: string | null;
};

type DocRow = {
  title: string;
  url: string;
  platform: string;
  interactions: number;
};

export async function handleDigest(env: RadarEnv, runDay: string, asJson: boolean): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT c.stable_key, c.heat, c.label_vi, c.size, e.insight, e.evidence_json, e.counter
     FROM communities c
     LEFT JOIN extracts e ON e.scope = 'community' AND e.scope_id = c.id
     WHERE c.run_day = ? ORDER BY c.heat DESC LIMIT 20`,
  )
    .bind(runDay)
    .all<CommunityRow>();
  const rows = results ?? [];
  const leidenMissing = rows.length === 0;
  const docs = leidenMissing
    ? (
        await env.DB.prepare(
          `SELECT title, url, platform, interactions FROM documents WHERE run_day = ? ORDER BY interactions DESC LIMIT 20`,
        )
          .bind(runDay)
          .all<DocRow>()
      ).results ?? []
    : [];
  if (asJson) {
    return jsonResponse(
      {
        question: QUESTION,
        run_day: runDay,
        status: leidenMissing ? (docs.length ? "docs" : "pending") : "ok",
        communities: rows,
        documents: docs,
      },
      true,
    );
  }
  let body: string;
  if (!leidenMissing) {
    body = rows
      .map((row) => {
        const label = escapeHtml(row.label_vi ?? row.stable_key ?? "community");
        const insight = row.insight ? `<p>${escapeHtml(row.insight)}</p>` : "";
        let ev = "";
        if (row.evidence_json) {
          try {
            const items = JSON.parse(row.evidence_json) as Array<{ claim: string; url: string; source: string }>;
            ev = `<ul>${items
              .map((x) => {
                const href = x.url.startsWith("http") ? x.url : "#";
                return `<li>${escapeHtml(x.claim)} <a href="${escapeHtml(href)}">${escapeHtml(x.source)}</a></li>`;
              })
              .join("")}</ul>`;
          } catch {
            ev = "";
          }
        }
        const counter = row.counter ? `<p><em>Phản biện:</em> ${escapeHtml(row.counter)}</p>` : "";
        return `<section><h2>${label} <small>heat ${Math.round(row.heat ?? 0)} · ${row.size ?? 0}</small></h2>${insight}${ev}${counter}</section>`;
      })
      .join("");
  } else if (docs.length > 0) {
    body = `<p>Chưa Leiden — tin thô theo interactions.</p><ol>${docs
      .map((d) => {
        const href = d.url.startsWith("https://") || d.url.startsWith("http://") ? d.url : "#";
        return `<li><a href="${escapeHtml(href)}">${escapeHtml(d.title)}</a> · ${escapeHtml(d.platform)} · ${d.interactions}</li>`;
      })
      .join("")}</ol>`;
  } else {
    body = "<p>cập nhật graph chưa xong</p>";
  }
  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"/>
  <title>Radarnews</title>
  <style>body{font-family:Georgia,serif;margin:2rem;background:#faf7f2;color:#0a0a0a}h1{font-size:1.35rem}</style>
</head>
<body>
  <h1>${escapeHtml(QUESTION)}</h1>
  ${body}
</body>
</html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": leidenMissing ? "no-store" : "public, max-age=3600",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}

function jsonResponse(payload: unknown, noStore: boolean): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": noStore ? "no-store" : "public, max-age=3600",
    },
  });
}
