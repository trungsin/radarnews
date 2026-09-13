export type RadarEnv = {
  DB: D1Database;
  CSR_BUCKET: R2Bucket;
  CRAWL_QUEUE: Queue;
  RADAR_WORKFLOW: Workflow;
  ASSETS: Fetcher;
  GEMINI_API_KEY?: string;
  GITHUB_DISPATCH_TOKEN?: string;
};
