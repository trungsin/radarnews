import type { NormalizedDoc, SourceKind } from "./types";

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function parsePayload(kind: SourceKind, text: string): NormalizedDoc[] {
  switch (kind) {
    case "hn":
      return parseHn(text);
    case "hf":
      return parseHf(text);
    case "github":
      return parseGithub(text);
    case "arxiv":
      return parseArxiv(text);
    case "bluesky":
      return parseBluesky(text);
    case "rss":
      return parseRss(text);
  }
}

function parseHn(text: string): NormalizedDoc[] {
  const data = JSON.parse(text) as { hits?: Array<Record<string, unknown>> };
  return (data.hits ?? []).map((hit) => {
    const title = String(hit.title ?? "");
    const url = String(hit.url ?? hit.story_url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`);
    return {
      url,
      title,
      published_at: hit.created_at ? String(hit.created_at) : null,
      author: hit.author ? String(hit.author) : null,
      interactions: num(hit.points) + num(hit.num_comments),
      platform: "hn",
      raw_excerpt: title,
    };
  });
}

function parseHf(text: string): NormalizedDoc[] {
  const rows = JSON.parse(text) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const id = String(row.id ?? "");
    return {
      url: `https://huggingface.co/${id}`,
      title: id,
      published_at: row.lastModified ? String(row.lastModified) : null,
      author: id.split("/")[0] ?? null,
      interactions: num(row.likes) + num(row.downloads),
      platform: "hf",
      raw_excerpt: String(row.pipeline_tag ?? ""),
    };
  });
}

function parseGithub(text: string): NormalizedDoc[] {
  const data = JSON.parse(text) as { items?: Array<Record<string, unknown>> };
  return (data.items ?? []).map((repo) => {
    const full = String(repo.full_name ?? "");
    let author: string | null = full.split("/")[0] ?? null;
    const owner = repo.owner;
    if (owner && typeof owner === "object" && "login" in owner && typeof owner.login === "string") {
      author = owner.login;
    }
    return {
      url: String(repo.html_url ?? `https://github.com/${full}`),
      title: full,
      published_at: repo.pushed_at ? String(repo.pushed_at) : null,
      author,
      interactions: num(repo.stargazers_count) + num(repo.forks_count),
      platform: "github",
      raw_excerpt: String(repo.description ?? "").slice(0, 500),
    };
  });
}

function tagContents(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim());
  }
  return out;
}

function parseArxiv(text: string): NormalizedDoc[] {
  const entries = text.split(/<entry>/).slice(1);
  return entries.map((entry) => {
    const id = tagContents(entry, "id")[0] ?? "";
    const title = (tagContents(entry, "title")[0] ?? "").replace(/\s+/g, " ");
    return {
      url: id,
      title,
      published_at: tagContents(entry, "published")[0] ?? null,
      author: tagContents(entry, "name")[0] ?? null,
      interactions: 0,
      platform: "arxiv",
      raw_excerpt: (tagContents(entry, "summary")[0] ?? "").replace(/\s+/g, " ").slice(0, 500),
    };
  });
}

function parseBluesky(text: string): NormalizedDoc[] {
  const data = JSON.parse(text) as { posts?: Array<Record<string, unknown>> };
  return (data.posts ?? []).map((post) => {
    const record = (post.record ?? {}) as Record<string, unknown>;
    const author = (post.author ?? {}) as Record<string, unknown>;
    const uri = String(post.uri ?? "");
    const title = String(record.text ?? "").slice(0, 180);
    return {
      url: uri,
      title,
      published_at: record.createdAt ? String(record.createdAt) : null,
      author: author.handle ? String(author.handle) : null,
      interactions: num(post.likeCount) + 2 * num(post.repostCount) + num(post.replyCount) + num(post.quoteCount),
      platform: "bluesky",
      raw_excerpt: title,
    };
  });
}

function parseRss(text: string): NormalizedDoc[] {
  const items = text.split(/<item[\s>]/i).slice(1);
  return items.map((item) => {
    const title = (tagContents(item, "title")[0] ?? "").replace(/\s+/g, " ");
    const link = tagContents(item, "link")[0] ?? "";
    const date = tagContents(item, "pubDate")[0] ?? tagContents(item, "published")[0] ?? null;
    return {
      url: link,
      title,
      published_at: date,
      author: null,
      interactions: 0,
      platform: "rss",
      raw_excerpt: (tagContents(item, "description")[0] ?? "").replace(/<[^>]+>/g, "").slice(0, 500),
    };
  });
}
