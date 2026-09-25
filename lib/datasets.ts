/**
 * The two benchmarks the site can show. Both go through the same page, the same
 * run script and the same statistics; only the data files and the words change.
 *
 * IMDB keeps the original top-level paths so the first benchmark's files and
 * commands are unchanged. Every other dataset lives under data/<key>/.
 */
export type DatasetKey = "imdb" | "github";

export type Dataset = {
  key: DatasetKey;
  /** Route the page is served at. */
  href: string;
  /** Selector label. */
  tab: string;
  /** Directory holding sample.json and results*.json, relative to the repo root. */
  dir: string;
  /** Download path under public/, as linked from the page. */
  csv: string;
  /** Checkpoint directory for the resumable run. */
  checkpoints: string;
  /** `npm run eval` arguments that select this dataset ("" for the default). */
  evalArgs: string;

  /** One item, lower case: "review", "comment". */
  noun: string;
  nouns: string;
  /** Hero headline noun phrase, plural: "movie reviews". */
  headline: string;
  eyebrow: string;
  /** Short name of the source, used in running text: "IMDB", "GitHub". */
  source: string;
  /** What the reference label is, for the Score step. */
  labelSource: string;
  /** Where the population comes from, for the Sample step. */
  population: string;
  paperTitle: string;
  /** Abstract clause: "class-balanced movie reviews from …". */
  abstractSource: string;
  /** Extra hint for the "Both fooled" gallery tab. */
  bothFooledHint: string;
  /** Opening of the length paragraph. */
  lengthIntro: string;
  /** Footer credit. */
  credit: string;
  /** Page metadata. */
  metaTitle: string;
  metaDescription: string;
};

export const DATASETS: Record<DatasetKey, Dataset> = {
  imdb: {
    key: "imdb",
    href: "/",
    tab: "Movie reviews",
    dir: "data",
    csv: "/results.csv",
    checkpoints: "data/.checkpoints",
    evalArgs: "",
    noun: "review",
    nouns: "reviews",
    headline: "movie reviews",
    eyebrow: "Blind benchmark · IMDB movie reviews · Vercel AI Gateway",
    source: "IMDB",
    labelSource: "the IMDB star-rating label",
    population: "unique IMDB reviews",
    paperTitle: "Blind binary sentiment classification on IMDB: an evaluation model versus a general-purpose flash LLM",
    abstractSource: "class-balanced movie reviews from the IMDB dataset of Maas et al. [1]",
    bothFooledHint: "Look for sarcasm, mixed verdicts, and star ratings that don’t match the text.",
    lengthIntro: "Short reviews carry fewer clues, while long ones may spend paragraphs on plot before giving a verdict.",
    credit: "Reviews from the IMDB Large Movie Review dataset (Maas et al., 2011).",
    metaTitle: "Classy: Blind Sentiment Benchmark",
    metaDescription:
      "1,000 IMDB reviews, two models on Vercel AI Gateway, no answer key. How often do typesafe-ai/jev and alibaba/qwen3.7-flash call a review positive or negative correctly?",
  },
  github: {
    key: "github",
    href: "/github",
    tab: "GitHub comments",
    dir: "data/github",
    csv: "/github/results.csv",
    checkpoints: "data/.checkpoints/github",
    evalArgs: " -- --dataset github",
    noun: "comment",
    nouns: "comments",
    headline: "developer comments",
    eyebrow: "Blind benchmark · GitHub pull-request and commit comments · Vercel AI Gateway",
    source: "GitHub",
    labelSource: "the human annotators’ label",
    population: "positive or negative comments in the GitHub sentiment gold standard",
    paperTitle:
      "Blind binary sentiment classification on GitHub developer comments: an evaluation model versus a general-purpose flash LLM",
    abstractSource: "class-balanced pull-request and commit comments from the GitHub sentiment gold standard of Novielli et al. [1]",
    bothFooledHint: "Look for sarcasm, emoticons, jargon, and frustration aimed at code rather than at people.",
    lengthIntro:
      "Most comments are a sentence or two, and the shortest give a model almost nothing to go on beyond a word or an emoticon.",
    credit:
      "Comments from the GitHub sentiment gold standard (Novielli et al., 2020), CC BY 4.0; neutral comments removed and a balanced sample drawn.",
    metaTitle: "Classy: Blind Sentiment Benchmark on GitHub Comments",
    metaDescription:
      "1,000 GitHub pull-request and commit comments, two models on Vercel AI Gateway, no answer key. How often do typesafe-ai/jev and alibaba/qwen3.7-flash call a comment positive or negative correctly?",
  },
};

export const DATASET_ORDER: DatasetKey[] = ["imdb", "github"];

export function isDatasetKey(v: unknown): v is DatasetKey {
  return v === "imdb" || v === "github";
}
