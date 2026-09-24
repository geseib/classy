/**
 * One-time benchmark run. Sends every sampled review to both models through
 * Vercel AI Gateway, with the ground-truth label withheld, and files the answers.
 *
 *   npm run eval                      # full run → data/results.json + public/results.csv
 *   npm run eval -- --limit 20        # smoke test (prints a summary, writes no results)
 *   npm run eval -- --concurrency 16
 *   npm run eval:mock                 # simulated answers → data/results.mock.json (layout preview only)
 *
 * Auth: AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN from `vercel env pull`), read
 * from the environment, .env.local or .env.
 *
 * Every successful answer is appended to data/.checkpoints/<model>.jsonl, so an
 * interrupted run resumes where it stopped. Failed calls are retried on the next run.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { experimental_evaluate as evaluate, generateText } from "ai";
import type { ModelInfo, ModelKey, Prediction, ResultsFile, SampleFile, SampleItem, Sentiment } from "../lib/types";

const { values } = parseArgs({
  options: {
    concurrency: { type: "string", default: "8" },
    limit: { type: "string" },
    mock: { type: "boolean", default: false },
    sample: { type: "string", default: "data/sample.json" },
  },
});

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// ─── The task, as both models see it ────────────────────────────────────────
// Same instructions and label definitions for both models. The dataset label
// is never part of the request.

const INSTRUCTIONS =
  "Classify the overall sentiment the author expresses toward the film in this IMDB movie review.";

const CRITERIA: Record<Sentiment, string> = {
  positive: "The reviewer's overall opinion of the movie is favorable.",
  negative: "The reviewer's overall opinion of the movie is unfavorable.",
};

const GENERATIVE_SYSTEM = [
  "You are a sentiment classifier.",
  INSTRUCTIONS,
  `positive: ${CRITERIA.positive}`,
  `negative: ${CRITERIA.negative}`,
  "Answer with exactly one lowercase word, positive or negative, and nothing else.",
].join("\n");

const GENERATIVE_TEMPLATE = "<review>\n{review}\n</review>";

const MODELS: Record<ModelKey, ModelInfo> = {
  jev: {
    key: "jev",
    id: "typesafe-ai/jev",
    name: "Jev",
    vendor: "Typesafe AI",
    kind: "evaluation",
    call: "experimental_evaluate({ state: review, questions: { sentiment: { type: 'choice', … } } })",
  },
  qwen: {
    key: "qwen",
    id: "alibaba/qwen3.7-flash",
    name: "Qwen3.7 Flash",
    vendor: "Alibaba",
    kind: "generative",
    call: "generateText({ system, prompt, temperature: 0 })",
  },
};

const TIMEOUT_MS = 90_000;
const MAX_RETRIES = 4;

// ─── Model calls ────────────────────────────────────────────────────────────

function gatewayCost(meta: unknown): number | undefined {
  const g = (meta as Record<string, Record<string, unknown>> | undefined)?.gateway;
  const c = g?.cost ?? g?.totalCost;
  const n = typeof c === "string" ? Number(c) : c;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

async function classifyJev(item: SampleItem): Promise<Prediction> {
  const start = performance.now();
  const result = await evaluate({
    model: MODELS.jev.id,
    state: item.text,
    questions: {
      sentiment: { type: "choice", instructions: INSTRUCTIONS, criteria: CRITERIA },
    },
    maxRetries: MAX_RETRIES,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const answer = result.answers.sentiment;
  const choice = answer.choice;
  const probs = answer.probabilities;
  return {
    id: item.id,
    prediction: choice === "positive" || choice === "negative" ? choice : null,
    pPositive: probs ? probs.positive : undefined,
    latencyMs: Math.round(performance.now() - start),
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cost: gatewayCost(result.providerMetadata),
  };
}

/** Accepts "positive", "Negative.", "**positive**"; rejects answers naming both labels. */
function parseSentiment(text: string): Sentiment | null {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .toLowerCase()
    .trim();
  const hits = new Set(cleaned.match(/\b(positive|negative)\b/g) ?? []);
  return hits.size === 1 ? ([...hits][0] as Sentiment) : null;
}

async function classifyQwen(item: SampleItem): Promise<Prediction> {
  const start = performance.now();
  const result = await generateText({
    model: MODELS.qwen.id,
    system: GENERATIVE_SYSTEM,
    prompt: GENERATIVE_TEMPLATE.replace("{review}", item.text),
    temperature: 0,
    maxOutputTokens: 2048,
    maxRetries: MAX_RETRIES,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return {
    id: item.id,
    prediction: parseSentiment(result.text),
    raw: result.text.trim().slice(0, 200),
    latencyMs: Math.round(performance.now() - start),
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cost: gatewayCost(result.finalStep.providerMetadata),
  };
}

const CLASSIFIERS: Record<ModelKey, (item: SampleItem) => Promise<Prediction>> = {
  jev: classifyJev,
  qwen: classifyQwen,
};

// ─── Simulated answers (layout preview only) ────────────────────────────────

function mockPredict(key: ModelKey, item: SampleItem, index: number): Prediction {
  // Deterministic hash → uniform in [0,1). No model is called.
  const u = (salt: number) => {
    let h = 2166136261 ^ salt;
    for (const ch of item.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return ((h >>> 0) % 100000) / 100000;
  };
  const accuracy = key === "jev" ? 0.95 : 0.92;
  const correct = u(key === "jev" ? 1 : 2) < accuracy;
  const prediction: Sentiment = correct ? item.label : item.label === "positive" ? "negative" : "positive";
  const conf = 0.5 + 0.5 * Math.pow(u(3), correct ? 0.25 : 1.2);
  return {
    id: item.id,
    prediction: key === "qwen" && index % 250 === 7 ? null : prediction,
    pPositive: key === "jev" ? (prediction === "positive" ? conf : 1 - conf) : undefined,
    raw: key === "qwen" ? prediction : undefined,
    latencyMs: Math.round((key === "jev" ? 180 : 420) + u(4) * (key === "jev" ? 220 : 900)),
    inputTokens: Math.round(item.text.length / 4) + 80,
    outputTokens: key === "jev" ? 1 : 2,
  };
}

// ─── Runner ─────────────────────────────────────────────────────────────────

const CHECKPOINT_DIR = "data/.checkpoints";

function loadCheckpoint(key: ModelKey): Map<string, Prediction> {
  const done = new Map<string, Prediction>();
  const file = `${CHECKPOINT_DIR}/${key}.jsonl`;
  if (!existsSync(file)) return done;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const p = JSON.parse(line) as Prediction;
    if (!p.error) done.set(p.id, p);
  }
  return done;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string; statusCode?: number };
  return [e.name, e.statusCode, e.message].filter(Boolean).join(" · ").slice(0, 300);
}

const progress: Record<ModelKey, { done: number; total: number; failed: number }> = {
  jev: { done: 0, total: 0, failed: 0 },
  qwen: { done: 0, total: 0, failed: 0 },
};

function renderProgress() {
  const line = (Object.keys(progress) as ModelKey[])
    .map((k) => {
      const p = progress[k];
      return `${MODELS[k].name} ${p.done}/${p.total}${p.failed ? ` (${p.failed} failed)` : ""}`;
    })
    .join("   ·   ");
  if (process.stdout.isTTY) process.stdout.write(`\r${line}   `);
  else console.log(line);
}

async function runModel(key: ModelKey, items: SampleItem[], concurrency: number) {
  const done = loadCheckpoint(key);
  const todo = items.filter((i) => !done.has(i.id));
  const file = `${CHECKPOINT_DIR}/${key}.jsonl`;
  progress[key] = { done: 0, total: todo.length, failed: 0 };
  if (todo.length === 0) return done;

  // Fail fast on auth or a wrong model id before fanning out.
  try {
    const first = await CLASSIFIERS[key](todo[0]);
    done.set(first.id, first);
    appendFileSync(file, JSON.stringify(first) + "\n");
    progress[key].done++;
  } catch (err) {
    console.error(`\n${MODELS[key].id} preflight failed: ${describeError(err)}`);
    if (/auth|401|403|api key|oidc/i.test(String((err as Error)?.message))) {
      console.error("Set AI_GATEWAY_API_KEY (see .env.example) or run `vercel env pull`.");
    }
    process.exit(1);
  }

  await pool(todo.slice(1), concurrency, async (item) => {
    let p: Prediction;
    try {
      p = await CLASSIFIERS[key](item);
    } catch (err) {
      progress[key].failed++;
      p = { id: item.id, prediction: null, latencyMs: 0, error: describeError(err) };
    }
    if (!p.error) done.set(p.id, p);
    appendFileSync(file, JSON.stringify(p) + "\n");
    progress[key].done++;
  });
  return done;
}

function pkgVersion(name: string): string {
  try {
    return JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
  } catch {
    return "unknown";
  }
}

function toCsv(results: ResultsFile, sample: SampleFile): string {
  const rowNum = new Map(sample.items.map((i) => [i.id, i.row]));
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "id", "csv_row", "label",
    "jev_prediction", "jev_p_positive", "jev_correct",
    "qwen_prediction", "qwen_raw", "qwen_correct",
  ];
  const lines = results.rows.map((r) =>
    [
      r.id, rowNum.get(r.id), r.label,
      r.jev.prediction, r.jev.pPositive?.toFixed(4), r.jev.prediction === r.label,
      r.qwen.prediction, r.qwen.raw, r.qwen.prediction === r.label,
    ].map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

async function main() {
  const sample = JSON.parse(readFileSync(values.sample!, "utf8")) as SampleFile;
  const limit = values.limit ? Number(values.limit) : undefined;
  const items = limit ? sample.items.slice(0, limit) : sample.items;
  const concurrency = Number(values.concurrency);
  const { items: _omit, ...sampleMeta } = sample;
  const started = Date.now();

  let answers: Record<ModelKey, Map<string, Prediction>>;
  if (values.mock) {
    answers = {
      jev: new Map(items.map((i, n) => [i.id, mockPredict("jev", i, n)])),
      qwen: new Map(items.map((i, n) => [i.id, mockPredict("qwen", i, n)])),
    };
  } else {
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
      console.error("No AI Gateway credentials. Set AI_GATEWAY_API_KEY in .env.local (see .env.example).");
      process.exit(1);
    }
    mkdirSync(CHECKPOINT_DIR, { recursive: true });
    console.log(`Classifying ${items.length} reviews with ${Object.keys(MODELS).length} models, concurrency ${concurrency}\n`);
    const ticker = setInterval(renderProgress, process.stdout.isTTY ? 250 : 10_000);
    const [jev, qwen] = await Promise.all([
      runModel("jev", items, concurrency),
      runModel("qwen", items, concurrency),
    ]);
    clearInterval(ticker);
    renderProgress();
    console.log("\n");
    answers = { jev, qwen };
  }

  const missing = (["jev", "qwen"] as const).flatMap((k) =>
    items.filter((i) => !answers[k].has(i.id)).map((i) => `${k}:${i.id}`),
  );

  for (const key of ["jev", "qwen"] as const) {
    const right = items.filter((i) => answers[key].get(i.id)?.prediction === i.label).length;
    console.log(`${MODELS[key].id.padEnd(22)} ${right}/${items.length} correct (${((100 * right) / items.length).toFixed(1)}%)`);
  }

  if (missing.length > 0) {
    console.error(`\n${missing.length} answers still missing (failed calls). Re-run \`npm run eval\` to retry them.`);
    process.exit(1);
  }
  if (limit) {
    console.log(`\n--limit run: summary only. Run without --limit to file data/results.json.`);
    return;
  }

  const results: ResultsFile = {
    simulated: values.mock!,
    runAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    sdk: { ai: pkgVersion("ai"), gateway: pkgVersion("@ai-sdk/gateway") },
    sample: sampleMeta,
    prompt: {
      instructions: INSTRUCTIONS,
      criteria: CRITERIA,
      generativeSystem: GENERATIVE_SYSTEM,
      generativeTemplate: GENERATIVE_TEMPLATE,
    },
    models: [MODELS.jev, MODELS.qwen],
    rows: items.map((i) => ({
      id: i.id,
      label: i.label,
      jev: answers.jev.get(i.id)!,
      qwen: answers.qwen.get(i.id)!,
    })),
  };

  if (values.mock) {
    writeFileSync("data/results.mock.json", JSON.stringify(results) + "\n");
    console.log("\nSimulated results → data/results.mock.json");
    console.log("Preview with: RESULTS_FILE=data/results.mock.json npm run dev");
  } else {
    writeFileSync("data/results.json", JSON.stringify(results, null, 1) + "\n");
    mkdirSync("public", { recursive: true });
    writeFileSync("public/results.csv", toCsv(results, sample));
    console.log("\nFiled → data/results.json and public/results.csv. Commit both and deploy.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
