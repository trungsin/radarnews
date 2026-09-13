/**
 * Rule-based entity extraction (no LLM). Turns a document title/repo id into
 * topic entities (lab / model / concept) so Leiden clusters by direction,
 * not by hosting platform. Generic hosts are intentionally NOT entities.
 */

export type Entity = { kind: "lab" | "model" | "concept"; name: string };

type Rule = { kind: Entity["kind"]; name: string; re: RegExp };

// name = canonical entity id; re = case-insensitive matcher with rough boundaries.
const RULES: Rule[] = [
  // Labs / orgs
  { kind: "lab", name: "openai", re: /\bopen\s?ai\b/i },
  { kind: "lab", name: "anthropic", re: /\banthropic\b/i },
  { kind: "lab", name: "google-deepmind", re: /\b(deepmind|google\s?ai|gemini team)\b/i },
  { kind: "lab", name: "meta-ai", re: /\b(meta ai|fair|meta llama)\b/i },
  { kind: "lab", name: "mistral", re: /\bmistral\b/i },
  { kind: "lab", name: "deepseek", re: /\bdeepseek\b/i },
  { kind: "lab", name: "alibaba-qwen", re: /\b(qwen|alibaba|tongyi)\b/i },
  { kind: "lab", name: "moonshot", re: /\b(moonshot|kimi)\b/i },
  { kind: "lab", name: "xai", re: /\b(xai|x\.ai|grok)\b/i },
  { kind: "lab", name: "cohere", re: /\bcohere\b/i },
  { kind: "lab", name: "stability", re: /\bstability ?ai\b/i },
  { kind: "lab", name: "black-forest", re: /\bblack.forest|flux\.1\b/i },
  { kind: "lab", name: "nvidia", re: /\bnvidia\b/i },
  { kind: "lab", name: "microsoft", re: /\bmicrosoft|phi-\d\b/i },
  { kind: "lab", name: "cursor", re: /\bcursor\b/i },
  { kind: "lab", name: "huggingface", re: /\bhugging ?face\b/i },
  // Model families
  { kind: "model", name: "gpt", re: /\bgpt-?\d|chatgpt\b/i },
  { kind: "model", name: "claude", re: /\bclaude\b/i },
  { kind: "model", name: "gemini", re: /\bgemini\b/i },
  { kind: "model", name: "llama", re: /\bllama\b/i },
  { kind: "model", name: "qwen", re: /\bqwen[\d.]*/i },
  { kind: "model", name: "deepseek-r", re: /\bdeepseek[- ]?(r\d|v\d)\b/i },
  { kind: "model", name: "mixtral", re: /\bmi(x)?tral\b/i },
  { kind: "model", name: "kimi", re: /\bkimi[- ]?k?\d?\b/i },
  { kind: "model", name: "flux", re: /\bflux(\.1)?\b/i },
  { kind: "model", name: "stable-diffusion", re: /\bstable[- ]?diffusion|sdxl\b/i },
  { kind: "model", name: "grok", re: /\bgrok-?\d?\b/i },
  { kind: "model", name: "o-series", re: /\bo[13](-(mini|pro|preview))?\b/i },
  { kind: "model", name: "phi", re: /\bphi-?\d\b/i },
  // Concepts / directions
  { kind: "concept", name: "agents", re: /\bagent(s|ic)?\b/i },
  { kind: "concept", name: "rag", re: /\brag\b|retrieval.augmented/i },
  { kind: "concept", name: "mcp", re: /\bmcp\b|model context protocol/i },
  { kind: "concept", name: "fine-tuning", re: /\bfine[- ]?tun/i },
  { kind: "concept", name: "quantization", re: /\bquantiz|gguf|4-bit|8-bit\b/i },
  { kind: "concept", name: "inference", re: /\binference|serving|vllm|throughput\b/i },
  { kind: "concept", name: "embeddings", re: /\bembedding|vector search|semantic search\b/i },
  { kind: "concept", name: "diffusion", re: /\bdiffusion\b/i },
  { kind: "concept", name: "reasoning", re: /\breasoning|chain.of.thought|test.time\b/i },
  { kind: "concept", name: "multimodal", re: /\bmultimodal|vision.language|vlm\b/i },
  { kind: "concept", name: "robotics", re: /\brobot|embodied\b/i },
  { kind: "concept", name: "coding", re: /\bcode|coding|copilot|codex|swe-?bench\b/i },
  { kind: "concept", name: "voice", re: /\bvoice|speech|tts|asr|transcrib\b/i },
  { kind: "concept", name: "training", re: /\bpretrain|pre-train|training run|from scratch\b/i },
  { kind: "concept", name: "benchmark", re: /\bbenchmark|eval|leaderboard\b/i },
];

const PLATFORM_HOSTS: Record<string, true> = {
  "github.com": true,
  "www.github.com": true,
  "huggingface.co": true,
  "arxiv.org": true,
  "export.arxiv.org": true,
  "news.ycombinator.com": true,
  "bsky.app": true,
  "twitter.com": true,
  "x.com": true,
  "medium.com": true,
  "youtube.com": true,
  "www.youtube.com": true,
};

/** Extract topic entities from a document. Platform hosts are excluded. */
export function extractEntities(doc: {
  platform: string;
  url: string;
  title: string;
}): Entity[] {
  const found = new Map<string, Entity>();
  // Title only. The URL carries platform hosts (huggingface.co, github.com)
  // that would otherwise become false lab hubs.
  for (const rule of RULES) {
    if (rule.re.test(doc.title)) found.set(`${rule.kind}:${rule.name}`, { kind: rule.kind, name: rule.name });
  }
  return [...found.values()];
}

export function isPlatformHost(host: string): boolean {
  return PLATFORM_HOSTS[host.toLowerCase()] === true;
}
