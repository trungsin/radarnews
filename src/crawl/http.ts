const FETCH_MS = 20_000;
const MAX_BYTES = 1_048_576;

export async function fetchAllowlisted(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("scheme");
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_MS),
    redirect: "manual",
    headers: { "user-agent": "radarnews-pipeline/0.1 (public-research-radar)" },
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error("redirect");
  }
  if (!res.ok) {
    throw new Error(`http ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new Error("body");
  }
  return new TextDecoder().decode(buf);
}
