export type SourceKind = "hn" | "hf" | "github" | "arxiv" | "bluesky" | "rss";

export type AllowlistedSource = {
  id: string;
  kind: SourceKind;
  url: string;
  enabled: boolean;
};

export type CrawlMessage = {
  run_id: string;
  run_day: string;
  source_id: string;
};

export type NormalizedDoc = {
  url: string;
  title: string;
  published_at: string | null;
  author: string | null;
  interactions: number;
  platform: string;
  raw_excerpt: string;
};
