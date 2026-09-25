/**
 * Draw a reproducible, class-balanced sample from a labelled sentiment dataset.
 *
 *   npm run sample -- "path/to/IMDB Dataset.csv" [--n 1000] [--seed 42]
 *   npm run sample -- data/raw/github_gold.csv --dataset github
 *
 * imdb    IMDB Dataset of 50K Movie Reviews (review,sentiment). Writes data/sample.json.
 *         The 66 MB source CSV is not committed; the sample is.
 * github  GitHub sentiment gold standard, Novielli et al. 2020 (ID;Polarity;Text,
 *         CC BY 4.0, committed at data/raw/github_gold.csv). Neutral comments are
 *         set aside. Writes data/github/sample.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DATASETS, isDatasetKey } from "../lib/datasets";
import type { SampleFile, SampleItem, Sentiment } from "../lib/types";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    n: { type: "string", default: "1000" },
    seed: { type: "string", default: "42" },
    dataset: { type: "string", default: "imdb" },
    out: { type: "string" },
  },
});

const csvPath = positionals[0];
if (!csvPath || !isDatasetKey(values.dataset)) {
  console.error('usage: npm run sample -- <source.csv> [--dataset imdb|github] [--n 1000] [--seed 42]');
  process.exit(1);
}
const dataset = values.dataset;
const outPath = values.out ?? path.join(DATASETS[dataset].dir, "sample.json");
const n = Number(values.n);
const seed = Number(values.seed);
if (!Number.isInteger(n) || n < 2 || n % 2 !== 0) {
  console.error("--n must be an even integer (the sample is split 50/50 by class)");
  process.exit(1);
}

/** RFC 4180 parser: quoted fields, embedded delimiters/newlines, "" escapes. */
function parseCsv(input: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** mulberry32: tiny, well-distributed, seedable PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Parsed = {
  source: string;
  pool: Record<Sentiment, SampleItem[]>;
  duplicates: number;
  excluded?: SampleFile["excluded"];
  unusable?: number;
};

function parseImdb(input: string): Parsed {
  const clean = (s: string) =>
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const [header, ...data] = parseCsv(input);
  if (header?.[0] !== "review" || header?.[1] !== "sentiment") {
    throw new Error(`unexpected header: ${JSON.stringify(header)}`);
  }

  const seen = new Set<string>();
  let duplicates = 0;
  const pool: Record<Sentiment, SampleItem[]> = { positive: [], negative: [] };
  data.forEach(([review, sentiment], i) => {
    if (review === undefined) return;
    if (sentiment !== "positive" && sentiment !== "negative") {
      throw new Error(`row ${i + 1}: unexpected sentiment ${JSON.stringify(sentiment)}`);
    }
    const text = clean(review);
    if (seen.has(text)) {
      duplicates++;
      return;
    }
    seen.add(text);
    const row = i + 1;
    pool[sentiment].push({ id: `imdb-${String(row).padStart(5, "0")}`, row, label: sentiment, text });
  });
  return { source: "IMDB Dataset of 50K Movie Reviews (Maas et al., 2011)", pool, duplicates };
}

function parseGithub(input: string): Parsed {
  // The Text column was CSV-quoted twice on export: after one level of parsing,
  // almost every text still ends in the closing quote of the inner level and
  // quotation marks inside a comment are still doubled. Undo the inner level.
  const clean = (s: string) => s.replace(/"$/, "").replace(/""/g, '"').trim();
  // Spreadsheet error values that replaced a comment during export.
  const unusableText = (s: string) => s === "" || /^(Err:\d+|#[A-Z/0!]+[?!]?)$/.test(s);

  const [header, ...data] = parseCsv(input, ";");
  if (header?.[0] !== "ID" || header?.[1] !== "Polarity" || header?.[2] !== "Text") {
    throw new Error(`unexpected header: ${JSON.stringify(header)}`);
  }

  const seen = new Set<string>();
  let duplicates = 0;
  let unusable = 0;
  const excluded = new Map<string, number>();
  const pool: Record<Sentiment, SampleItem[]> = { positive: [], negative: [] };
  data.forEach(([id, polarity, raw], i) => {
    if (raw === undefined) return;
    if (polarity !== "positive" && polarity !== "negative") {
      if (polarity !== "neutral") throw new Error(`row ${i + 1}: unexpected polarity ${JSON.stringify(polarity)}`);
      excluded.set(polarity, (excluded.get(polarity) ?? 0) + 1);
      return;
    }
    const text = clean(raw);
    if (unusableText(text)) {
      unusable++;
      return;
    }
    if (seen.has(text)) {
      duplicates++;
      return;
    }
    seen.add(text);
    pool[polarity].push({ id: `gh-${id}`, row: i + 1, label: polarity, text });
  });
  return {
    source: "GitHub sentiment gold standard (Novielli et al., 2020), CC BY 4.0",
    pool,
    duplicates,
    excluded: [...excluded].map(([label, count]) => ({ label, count })),
    unusable,
  };
}

const input = readFileSync(csvPath, "utf8");
const { source, pool, duplicates, excluded, unusable } = dataset === "imdb" ? parseImdb(input) : parseGithub(input);

const rand = rng(seed);
const half = n / 2;
if (pool.positive.length < half || pool.negative.length < half) {
  throw new Error(`not enough items: ${pool.positive.length} positive, ${pool.negative.length} negative, need ${half} of each`);
}
const items = shuffle(
  [...shuffle(pool.positive, rand).slice(0, half), ...shuffle(pool.negative, rand).slice(0, half)],
  rand,
);

const out: SampleFile = {
  source,
  seed,
  size: items.length,
  populationSize: pool.positive.length + pool.negative.length,
  duplicatesRemoved: duplicates,
  ...(excluded ? { excluded } : {}),
  ...(unusable !== undefined ? { unusableRemoved: unusable } : {}),
  createdAt: new Date().toISOString(),
  items,
};
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(
  `sampled ${items.length} (${half} pos / ${half} neg) from ${out.populationSize} unique items ` +
    `(${duplicates} duplicates dropped` +
    (excluded?.length ? `, ${excluded.map((e) => `${e.count} ${e.label}`).join(", ")} set aside` : "") +
    (unusable ? `, ${unusable} unusable` : "") +
    `), seed ${seed} → ${outPath}`,
);
