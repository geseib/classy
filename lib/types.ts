export type Sentiment = "positive" | "negative";

export type SampleItem = {
  /** Stable id derived from the row number in the source CSV. */
  id: string;
  /** 1-based data row in `IMDB Dataset.csv` (header excluded). */
  row: number;
  /** Ground truth. Never sent to a model. */
  label: Sentiment;
  /** Review text with the dataset's `<br />` tags converted to newlines. */
  text: string;
};

export type SampleFile = {
  source: string;
  seed: number;
  size: number;
  populationSize: number;
  duplicatesRemoved: number;
  createdAt: string;
  items: SampleItem[];
};

export type ModelKey = "jev" | "qwen";

export type Prediction = {
  id: string;
  /** Parsed answer, or null when the call failed or the output was unparseable. */
  prediction: Sentiment | null;
  /** Model-reported P(positive). Only the evaluation model returns this. */
  pPositive?: number;
  /** Raw text output (generative model only), trimmed to 200 chars. */
  raw?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** USD, when AI Gateway reports it in provider metadata. */
  cost?: number;
  error?: string;
};

export type ModelInfo = {
  key: ModelKey;
  id: string;
  name: string;
  vendor: string;
  kind: "evaluation" | "generative";
  /** How the SDK was called, shown verbatim in the methodology section. */
  call: string;
  /** List price in USD per million tokens, used for expected cost regardless of free tiers or credits. */
  pricing?: { inputPerMTok: number; outputPerMTok: number };
};

/** `npm run eval -- --speed N`: single-attempt request timings, throttled calls discarded. */
export type SpeedFile = {
  runAt: string;
  /** Reviews timed per model (first N of the sample), after one discarded warm-up call. */
  n: number;
  models: Record<ModelKey, { latenciesMs: number[]; p50: number; p95: number; throttledDiscarded: number }>;
};

/** One reference model on the first N sample reviews, as a point of comparison. */
export type ReferenceRun = {
  runAt: string;
  model: Omit<ModelInfo, "key"> & { key: string };
  /** Same instructions and labels as the benchmark; single attempts, one at a time, throttled calls discarded. */
  rows: { id: string; label: Sentiment; answer: Prediction }[];
  throttledDiscarded: number;
  /**
   * "api": called through AI Gateway like the benchmark models (timed, token counts measured).
   * "subagent": answered by a Claude Code subagent on the same prompt, blind to labels; no per-request
   * timing, and tokens are an estimate, so cost is a lower bound at list price.
   */
  via: "api" | "subagent";
  estimatedTokens?: { inputPerReview: number; outputPerReview: number; basis: string };
};

/** `npm run eval -- --reference N` adds or replaces its model's run here. */
export type ReferenceFile = { references: ReferenceRun[] };

export type ResultsFile = {
  /** True only for `npm run eval:mock` output. The page labels it loudly. */
  simulated: boolean;
  /** Set by `npm run eval -- --partial`: an interim filing of the reviews both models have answered so far. */
  partial?: { answered: number; of: number };
  runAt: string;
  durationMs: number;
  sdk: { ai: string; gateway: string };
  sample: Omit<SampleFile, "items">;
  prompt: {
    instructions: string;
    criteria: Record<Sentiment, string>;
    generativeSystem: string;
    generativeTemplate: string;
  };
  models: ModelInfo[];
  /** One row per sampled review, in sample order. */
  rows: {
    id: string;
    label: Sentiment;
    jev: Prediction;
    qwen: Prediction;
  }[];
};
