import type { RadarEnv } from "../env";
import { escapeHtml } from "./html";

const QUESTION =
  "Giới nghiên cứu và ứng dụng AI/Agent đang có gì thú vị, và đang dịch chuyển về hướng nào?";

type CommunityRow = {
  stable_key: string | null;
  heat: number | null;
  label_vi: string | null;
  size: number | null;
};

export async function handleDigest(env: RadarEnv, runDay: string, asJson: boolean): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT stable_key, heat, label_vi, size FROM communities WHERE run_day = ? ORDER BY heat DESC LIMIT 20`,
  )
    .bind(runDay)
    .all<CommunityRow>();
  const rows = results ?? [];
  const leidenMissing = rows.length === 0;
  if (asJson) {
    return jsonResponse(
      {
        question: QUESTION,
        run_day: runDay,
        status: leidenMissing ? "pending" : "ok",
        communities: rows,
      },
      leidenMissing,
    );
  }
  const items = rows
    .map((row) => {
      const label = escapeHtml(row.label_vi ?? row.stable_key ?? "community");
      const heat = row.heat ?? 0;
      const size = row.size ?? 0;
      return `<li><strong>${label}</strong> heat ${heat} · ${size} nodes</li>`;
    })
    .join("");
  const body = leidenMissing
    ? "<p>cập nhật graph chưa xong</p>"
    : `<ol>${items}</ol>`;
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
