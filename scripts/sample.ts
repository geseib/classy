/**
 * Draw a reproducible, class-balanced sample from the IMDB 50K dataset.
 *
 *   npm run sample -- "path/to/IMDB Dataset.csv" [--n 1000] [--seed 42]
 *
 * Writes data/sample.json. The full CSV is not committed; the sample is,
 * so the eval can be re-run without the 66 MB source file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { SampleFile, SampleItem, Sentiment } from "../lib/types";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    n: { type: "string", default: "1000" },
    seed: { type: "string", default: "42" },
    out: { type: "string", default: "data/sample.json" },
  },
});

const csvPath = positionals[0];
if (!csvPath) {
  console.error('usage: npm run sample -- "IMDB Dataset.csv" [--n 1000] [--seed 42]');
  process.exit(1);
}
const n = Number(values.n);
const seed = Number(values.seed);
if (!Number.isInteger(n) || n < 2 || n % 2 !== 0) {
  console.error("--n must be an even integer (the sample is split 50/50 by class)");
  process.exit(1);
}

/** RFC 4180 parser: quoted fields, embedded commas/newlines, "" escapes. */
function parseCsv(input: string): string[][] {
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
    } else if (c === ",") {
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

const clean = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const [header, ...data] = parseCsv(readFileSync(csvPath, "utf8"));
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

const rand = rng(seed);
const half = n / 2;
const items = shuffle(
  [...shuffle(pool.positive, rand).slice(0, half), ...shuffle(pool.negative, rand).slice(0, half)],
  rand,
);

const out: SampleFile = {
  source: "IMDB Dataset of 50K Movie Reviews (Maas et al., 2011)",
  seed,
  size: items.length,
  populationSize: pool.positive.length + pool.negative.length,
  duplicatesRemoved: duplicates,
  createdAt: new Date().toISOString(),
  items,
};
writeFileSync(values.out!, JSON.stringify(out, null, 1) + "\n");
console.log(
  `sampled ${items.length} (${half} pos / ${half} neg) from ${out.populationSize} unique reviews ` +
    `(${duplicates} duplicates dropped), seed ${seed} → ${values.out}`,
);
