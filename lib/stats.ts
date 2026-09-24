import type { ModelKey, Prediction, ResultsFile, SampleItem, Sentiment } from "./types";

export type Row = ResultsFile["rows"][number] & { text: string; words: number };

/** Wilson score interval, 95%. Better behaved than the normal approximation near 100%. */
export function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function logChoose(n: number, k: number) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** Two-sided exact McNemar test on the discordant pairs (b, c). */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type Confusion = Record<Sentiment, Record<Sentiment | "none", number>>;

export type ModelMetrics = {
  key: ModelKey;
  n: number;
  correct: number;
  accuracy: number;
  ci: [number, number];
  unanswered: number;
  confusion: Confusion;
  precision: Record<Sentiment, number>;
  recall: Record<Sentiment, number>;
  f1: Record<Sentiment, number>;
  macroF1: number;
  latency: { p50: number; p95: number };
  meanInputTokens: number | null;
  meanOutputTokens: number | null;
  costPer1k: number | null;
  /** Token counts × list price, so a free tier or credits don't read as zero cost. */
  expectedCostPer1k: number | null;
};

export function modelMetrics(rows: Row[], key: ModelKey, pricing?: { inputPerMTok: number; outputPerMTok: number }): ModelMetrics {
  const confusion: Confusion = {
    positive: { positive: 0, negative: 0, none: 0 },
    negative: { positive: 0, negative: 0, none: 0 },
  };
  const preds: Prediction[] = rows.map((r) => r[key]);
  rows.forEach((r) => {
    confusion[r.label][r[key].prediction ?? "none"]++;
  });
  const correct = confusion.positive.positive + confusion.negative.negative;
  const n = rows.length;
  const precision = {} as Record<Sentiment, number>;
  const recall = {} as Record<Sentiment, number>;
  const f1 = {} as Record<Sentiment, number>;
  for (const cls of ["positive", "negative"] as const) {
    const other = cls === "positive" ? "negative" : "positive";
    const tp = confusion[cls][cls];
    const predicted = tp + confusion[other][cls];
    const actual = tp + confusion[cls][other] + confusion[cls].none;
    precision[cls] = predicted ? tp / predicted : 0;
    recall[cls] = actual ? tp / actual : 0;
    f1[cls] = precision[cls] + recall[cls] ? (2 * precision[cls] * recall[cls]) / (precision[cls] + recall[cls]) : 0;
  }
  const lat = preds.map((p) => p.latencyMs).sort((a, b) => a - b);
  const inTok = preds.map((p) => p.inputTokens).filter((t): t is number => typeof t === "number");
  const outTok = preds.map((p) => p.outputTokens).filter((t): t is number => typeof t === "number");
  const costs = preds.map((p) => p.cost).filter((c): c is number => typeof c === "number");
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const meanIn = mean(inTok);
  const meanOut = mean(outTok);
  return {
    key,
    n,
    correct,
    accuracy: n ? correct / n : 0,
    ci: wilson(correct, n),
    unanswered: confusion.positive.none + confusion.negative.none,
    confusion,
    precision,
    recall,
    f1,
    macroF1: (f1.positive + f1.negative) / 2,
    latency: { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95) },
    meanInputTokens: meanIn,
    meanOutputTokens: meanOut,
    // Only report cost when the gateway priced every call; a partial sum would understate it.
    costPer1k: costs.length === n && n > 0 ? (costs.reduce((a, b) => a + b, 0) / n) * 1000 : null,
    expectedCostPer1k:
      pricing && meanIn !== null && meanOut !== null
        ? ((meanIn * pricing.inputPerMTok + meanOut * pricing.outputPerMTok) / 1e6) * 1000
        : null,
  };
}

export type Agreement = {
  bothRight: number;
  onlyJev: number;
  onlyQwen: number;
  bothWrong: number;
  pValue: number;
};

export function agreement(rows: Row[]): Agreement {
  const a = { bothRight: 0, onlyJev: 0, onlyQwen: 0, bothWrong: 0 };
  for (const r of rows) {
    const j = r.jev.prediction === r.label;
    const q = r.qwen.prediction === r.label;
    if (j && q) a.bothRight++;
    else if (j) a.onlyJev++;
    else if (q) a.onlyQwen++;
    else a.bothWrong++;
  }
  return { ...a, pValue: mcnemarExact(a.onlyJev, a.onlyQwen) };
}

export type LengthBucket = {
  minWords: number;
  maxWords: number;
  n: number;
  accuracy: Record<ModelKey, number>;
};

/** Accuracy by review length, split into equal-count buckets. */
export function byLength(rows: Row[], buckets = 5): LengthBucket[] {
  const sorted = [...rows].sort((a, b) => a.words - b.words);
  const out: LengthBucket[] = [];
  for (let b = 0; b < buckets; b++) {
    const slice = sorted.slice(Math.round((b * sorted.length) / buckets), Math.round(((b + 1) * sorted.length) / buckets));
    if (slice.length === 0) continue;
    const acc = (k: ModelKey) => slice.filter((r) => r[k].prediction === r.label).length / slice.length;
    out.push({
      minWords: slice[0].words,
      maxWords: slice[slice.length - 1].words,
      n: slice.length,
      accuracy: { jev: acc("jev"), qwen: acc("qwen") },
    });
  }
  return out;
}

export type CalibrationBin = { lo: number; hi: number; n: number; confidence: number; accuracy: number };

/**
 * Reliability of the evaluation model's probabilities. Confidence is the
 * probability it assigned to the label it chose.
 */
export function calibration(rows: Row[], key: ModelKey = "jev") {
  const scored = rows.filter((r) => typeof r[key].pPositive === "number" && r[key].prediction);
  if (scored.length === 0) return null;
  const width = 0.05;
  const bins: CalibrationBin[] = [];
  for (let lo = 0.5; lo < 1 - 1e-9; lo += width) {
    const hi = lo + width;
    const inBin = scored.filter((r) => {
      const c = confidenceOf(r[key])!;
      return c >= lo && (hi >= 1 - 1e-9 ? c <= 1 : c < hi);
    });
    if (inBin.length === 0) continue;
    bins.push({
      lo,
      hi,
      n: inBin.length,
      confidence: inBin.reduce((s, r) => s + confidenceOf(r[key])!, 0) / inBin.length,
      accuracy: inBin.filter((r) => r[key].prediction === r.label).length / inBin.length,
    });
  }
  const ece = bins.reduce((s, b) => s + (b.n / scored.length) * Math.abs(b.accuracy - b.confidence), 0);
  const wrong = scored.filter((r) => r[key].prediction !== r.label).map((r) => confidenceOf(r[key])!);
  const right = scored.filter((r) => r[key].prediction === r.label).map((r) => confidenceOf(r[key])!);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return { bins, ece, n: scored.length, meanWhenRight: mean(right), meanWhenWrong: mean(wrong) };
}

export function confidenceOf(p: Prediction): number | undefined {
  if (typeof p.pPositive !== "number" || !p.prediction) return undefined;
  return p.prediction === "positive" ? p.pPositive : 1 - p.pPositive;
}

export function joinRows(results: ResultsFile, items: SampleItem[]): Row[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return results.rows.map((r) => {
    const text = byId.get(r.id)?.text ?? "";
    return { ...r, text, words: text.split(/\s+/).filter(Boolean).length };
  });
}
