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
};

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
