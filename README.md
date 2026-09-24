# classy

A blind sentiment benchmark, published as a static page: half marketing, half research paper.

We take 1,000 IMDB movie reviews with known sentiment. We ask two models on
[Vercel AI Gateway](https://vercel.com/ai-gateway) to label each one positive or negative,
without giving them the answer, and score every reply against the human label:

| Model | Kind | How it is called |
| --- | --- | --- |
| `typesafe-ai/jev` | evaluation model | `experimental_evaluate` with one `choice` question; returns the label plus a probability per label |
| `alibaba/qwen3.7-flash` | general-purpose LLM | `generateText` at temperature 0; the one-word reply is parsed |

The benchmark runs **once**. Its answers are filed in `data/results.json` (and
`public/results.csv` for download), and the Next.js page renders them at build time.
The deployed site makes no model calls and needs no API key.

## Layout

```
data/sample.json        1,000 reviews (500 pos / 500 neg), seeded. Committed.
data/results.json       every model answer, written by the one-time run. Committed.
public/results.csv      the same answers as a flat CSV, linked from the page.
scripts/sample.ts       builds data/sample.json from the full IMDB CSV
scripts/run-eval.ts     the one-time run (resumable)
lib/stats.ts            accuracy, Wilson CIs, exact McNemar, calibration, length buckets
app/page.tsx            the page
```

## Run the benchmark (once)

```bash
npm install
cp .env.example .env.local          # paste an AI Gateway key into AI_GATEWAY_API_KEY
npm run eval -- --limit 20          # optional smoke test: prints accuracy, files nothing
npm run eval                        # 1,000 reviews × 2 models → data/results.json + public/results.csv
git add data/results.json public/results.csv
git commit -m "File benchmark results"
```

`vercel env pull` also works: the AI SDK picks up `VERCEL_OIDC_TOKEN` from `.env.local`.

The run saves each answer to `data/.checkpoints/` as it arrives. If it is interrupted,
run `npm run eval` again and it picks up where it stopped; failed calls are retried.
Use `--concurrency N` (default 8) to go faster or to stay under rate limits.

The ground-truth label is never sent. Each request carries only the review text, the
instructions and the two label definitions (see `scripts/run-eval.ts`).

## Preview the page before running

```bash
npm run eval:mock                               # simulated answers, no API calls
RESULTS_FILE=results.mock.json npm run dev
```

The mock file is git-ignored, and the page shows a "simulated data" banner while it is in use.
Without any results file, the page renders a "results pending" version.

## Deploy

Import the repo in Vercel (framework: Next.js). No environment variables are needed,
because the page is prerendered from the committed `data/results.json`.

## Re-sampling

`data/sample.json` is committed, so you don't need the 66 MB source CSV. To draw a
different sample from the [IMDB dataset](https://ai.stanford.edu/~amaas/data/sentiment/)
("IMDB Dataset of 50K Movie Reviews" CSV):

```bash
npm run sample -- "IMDB Dataset.csv" --n 2000 --seed 7
```

The script drops exact duplicates (419 of the 50,000), converts `<br />` tags to newlines,
and takes an equal number of positive and negative reviews.
