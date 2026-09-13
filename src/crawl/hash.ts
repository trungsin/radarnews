export async function contentHash(url: string, publishedAt: string, title: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${url}\0${publishedAt}\0${title}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
