import { DATASETS, DATASET_ORDER, type Dataset, type DatasetKey } from "@/lib/datasets";
import { loadData } from "@/lib/load";
import { agreement, byLength, calibration, confidenceOf, joinRows, modelMetrics, wilson, type Row } from "@/lib/stats";
import type { ModelInfo, ModelKey, ReferenceFile, ResultsFile, SampleFile, SpeedFile } from "@/lib/types";
import {
  AccuracyChart,
  AgreementTable,
  ConfusionMatrix,
  LengthChart,
  Legend,
  ModelSwatch,
  ReliabilityChart,
  pct,
} from "@/components/charts";
import Waffle, { type WaffleCell } from "@/components/Waffle";
import Gallery, { type GalleryItem, type GalleryTab } from "@/components/Gallery";

const fmt = (n: number) => n.toLocaleString("en-US");
const ms = (v: number) => (v < 1000 ? `${fmt(Math.round(v))} ms` : `${(v / 1000).toFixed(1)} s`);
const usd = (c: number | null) => (c === null ? "n/a" : `$${c < 0.1 ? c.toFixed(4) : c.toFixed(2)}`);
const fmtP = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Models as planned, for the page shell before any results are filed. */
const PLANNED: ModelInfo[] = [
  { key: "jev", id: "typesafe-ai/jev", name: "Jev", vendor: "Typesafe AI", kind: "evaluation", call: "experimental_evaluate" },
  { key: "qwen", id: "alibaba/qwen3.7-flash", name: "Qwen3.7 Flash", vendor: "Alibaba", kind: "generative", call: "generateText" },
];

/**
 * One benchmark page. Every dataset gets the same sections in the same order;
 * only the data and the dataset's wording (lib/datasets.ts) differ.
 */
export default function BenchmarkPage({ dataset }: { dataset: DatasetKey }) {
  const ds = DATASETS[dataset];
  const { sample, results, speed, reference } = loadData(dataset);
  const models = results?.models ?? PLANNED;
  return (
    <>
      {results?.simulated && (
        <div className="sim-banner" role="status">
          Simulated data for layout preview. No model was called. Run <code>npm run eval{ds.evalArgs}</code> to file real
          answers.
        </div>
      )}
      {results?.partial && (
        <div className="sim-banner" role="status">
          Interim results: {fmt(results.partial.answered)} of {fmt(results.partial.of)} {ds.nouns}
          answered by both models so far. The run is still in progress.
        </div>
      )}
      <Nav ds={ds} hasResults={!!results && !results.simulated} />
      {results ? (
        <WithResults ds={ds} results={results} sample={sample} speed={speed} reference={reference} />
      ) : (
        <Pending ds={ds} sample={sample} models={models} />
      )}
      <Footer ds={ds} />
    </>
  );
}

function Nav({ ds, hasResults }: { ds: Dataset; hasResults: boolean }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a href="#top" className="wordmark">
          <span className="wordmark-mark" aria-hidden>
            <span />
            <span />
          </span>
          classy
        </a>
        <div className="seg ds-switch" role="navigation" aria-label="Dataset">
          {DATASET_ORDER.map((k) => {
            const d = DATASETS[k];
            const on = k === ds.key;
            return (
              <a key={k} href={d.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
                {d.tab}
              </a>
            );
          })}
        </div>
        <div className="nav-links">
          <a href="#results">Results</a>
          <a href="#errors">Errors</a>
          <a href="#method">Method</a>
          {hasResults && (
            <a href={ds.csv} className="nav-cta" download>
              Download data
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────────

function Hero({
  ds,
  n,
  models,
  pending,
  children,
}: {
  ds: Dataset;
  n: number;
  models: ModelInfo[];
  pending?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className="hero" id="top">
      <div className="hero-inner">
        <p className="eyebrow">{ds.eyebrow}</p>
        <h1>
          {fmt(n)} {ds.headline}.
          <br />
          Two models. <em>No answer key.</em>
        </h1>
        <p className="lede">
          {pending ? "We ask " : "We asked "}
          <strong>{models[0].name}</strong> and <strong>{models[1].name}</strong> to call each {ds.source} {ds.noun} positive
          or negative, without ever showing them the human {ds.key === "imdb" ? "rating" : "label"}. {pending ? "Then we score" : "Then we scored"} every answer.
        </p>
        {children}
      </div>
    </header>
  );
}

function Scorecards({
  metrics,
  models,
  pValue,
  speed,
  nouns,
}: {
  metrics: Record<ModelKey, ReturnType<typeof modelMetrics>>;
  models: ModelInfo[];
  pValue: number;
  speed: SpeedFile | null;
  nouns: string;
}) {
  const [a, b] = models.map((m) => metrics[m.key]);
  const diff = Math.abs(a.accuracy - b.accuracy) * 100;
  return (
    <>
      <div className="scorecards">
        {models.map((m) => {
          const s = metrics[m.key];
          return (
            <div className={`scorecard sc-${m.key}`} key={m.key}>
              <div className="sc-head">
                <span className="sc-name">
                  <ModelSwatch k={m.key} />
                  {m.name}
                </span>
                <code className="sc-id">{m.id}</code>
              </div>
              <div className="sc-figure">{pct(s.accuracy)}</div>
              <div className="sc-sub">
                {fmt(s.correct)} of {fmt(s.n)} correct · 95% CI {pct(s.ci[0])}–{pct(s.ci[1])}
              </div>
              <div className={`meter meter-${m.key}`} aria-hidden>
                <span style={{ width: pct(s.accuracy) }} />
              </div>
              <dl className="sc-stats">
                <div>
                  <dt>Median response</dt>
                  <dd>{ms(medianResponse(m.key, s, speed))}</dd>
                </div>
                <div>
                  <dt>Cost / 1k {nouns}</dt>
                  <dd>{usd(s.expectedCostPer1k)}</dd>
                </div>
              </dl>
              <div className="sc-kind">{m.kind === "evaluation" ? "Purpose-built evaluation model" : "General-purpose flash LLM"}</div>
            </div>
          );
        })}
      </div>
      <p className="hero-foot">
        <span>
          Gap <strong>{diff.toFixed(1)} pts</strong>
        </span>
        <span>
          Paired test <strong>{fmtP(pValue)}</strong>
        </span>
        <span>
          Class balance <strong>50 / 50</strong>
        </span>
        <span>
          Chance <strong>50%</strong>
        </span>
      </p>
    </>
  );
}

function Protocol({ ds, sample }: { ds: Dataset; sample: Omit<SampleFile, "items"> }) {
  const steps = [
    {
      n: "01",
      title: "Sample",
      body: `${fmt(sample.size)} ${ds.nouns} drawn at random from ${fmt(sample.populationSize)} ${ds.population}, half positive and half negative (seed ${sample.seed}).`,
    },
    { n: "02", title: "Blind", body: `The human label is set aside. Each model sees only the ${ds.noun} and the task.` },
    { n: "03", title: "Ask", body: "Both models are called through Vercel AI Gateway with the same instructions and label definitions." },
    { n: "04", title: "Score", body: `Every answer is checked against ${ds.labelSource} and filed, once.` },
  ];
  return (
    <ol className="protocol">
      {steps.map((s) => (
        <li key={s.n}>
          <span className="protocol-n">{s.n}</span>
          <strong>{s.title}</strong>
          <p>{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

// ─── Results page ───────────────────────────────────────────────────────────

function WithResults({
  ds,
  results,
  sample,
  speed,
  reference,
}: {
  ds: Dataset;
  results: ResultsFile;
  sample: SampleFile;
  speed: SpeedFile | null;
  reference: ReferenceFile | null;
}) {
  const rows = joinRows(results, sample.items);
  const models = results.models;
  const [J, Q] = models;
  const metrics = {
    jev: modelMetrics(rows, "jev", J.pricing),
    qwen: modelMetrics(rows, "qwen", Q.pricing),
  };
  const agree = agreement(rows);
  const lengths = byLength(rows);
  const cal = calibration(rows, "jev");
  const n = rows.length;
  const meanAcc = (metrics.jev.accuracy + metrics.qwen.accuracy) / 2;
  const bucketHalfWidth = 100 * 1.96 * Math.sqrt((meanAcc * (1 - meanAcc)) / (lengths[0]?.n || 1));
  const hasCsv = !results.simulated;
  const { noun, nouns } = ds;

  const leader = metrics.jev.accuracy >= metrics.qwen.accuracy ? J : Q;
  const trailer = leader === J ? Q : J;
  const tie = metrics.jev.correct === metrics.qwen.correct;
  const gap = Math.abs(metrics.jev.accuracy - metrics.qwen.accuracy) * 100;
  const significant = agree.pValue < 0.05;
  const disagreements = agree.onlyJev + agree.onlyQwen;
  const leaderWins = leader === J ? agree.onlyJev : agree.onlyQwen;

  const waffleCells: WaffleCell[] = [...rows]
    .sort((a, b) => (a.label === b.label ? 0 : a.label === "positive" ? -1 : 1))
    .map((r) => {
      const v = (k: ModelKey) => (r[k].prediction === null ? 2 : r[k].prediction === r.label ? 0 : 1) as 0 | 1 | 2;
      const cell: WaffleCell = {
        id: r.id,
        label: r.label,
        jev: { v: v("jev"), said: r.jev.prediction },
        qwen: { v: v("qwen"), said: r.qwen.prediction },
      };
      if (cell.jev.v || cell.qwen.v) cell.snippet = r.text.slice(0, 140).replace(/\s+/g, " ").trim();
      return cell;
    });

  const toItem = (r: Row): GalleryItem => ({
    id: r.id,
    label: r.label,
    text: r.text,
    words: r.words,
    jev: { said: r.jev.prediction, confidence: confidenceOf(r.jev) },
    qwen: { said: r.qwen.prediction, raw: r.qwen.raw },
  });
  const shortestFirst = (a: Row, b: Row) => a.words - b.words;
  const split = rows.filter((r) => (r.jev.prediction === r.label) !== (r.qwen.prediction === r.label));
  const bothWrong = rows.filter((r) => r.jev.prediction !== r.label && r.qwen.prediction !== r.label);
  const confidentMisses = rows
    .filter((r) => r.jev.prediction && r.jev.prediction !== r.label && confidenceOf(r.jev) !== undefined)
    .sort((a, b) => confidenceOf(b.jev)! - confidenceOf(a.jev)!);
  const PER_TAB = 12;
  const tabs: GalleryTab[] = [
    {
      key: "split",
      title: "Split decisions",
      blurb: `${cap(nouns)} where exactly one model was right. ${leader.name} won ${fmt(leaderWins)} of these ${fmt(disagreements)}. Shortest first.`,
      total: split.length,
      items: split.sort(shortestFirst).slice(0, PER_TAB).map(toItem),
    },
    {
      key: "both",
      title: "Both fooled",
      blurb: `${cap(nouns)} both models got wrong. ${ds.bothFooledHint} Shortest first.`,
      total: bothWrong.length,
      items: bothWrong.sort(shortestFirst).slice(0, PER_TAB).map(toItem),
    },
    ...(cal
      ? [
          {
            key: "confident",
            title: `${J.name}’s confident misses`,
            blurb: `Wrong answers where ${J.name} reported the highest probability for the label it chose.`,
            total: confidentMisses.length,
            items: confidentMisses.slice(0, PER_TAB).map(toItem),
          },
        ]
      : []),
  ];

  const unparsedNote = (["jev", "qwen"] as const)
    .filter((k) => metrics[k].unanswered > 0)
    .map((k) => `${models.find((m) => m.key === k)!.name}: ${metrics[k].unanswered}`)
    .join(", ");

  return (
    <main>
      <Hero ds={ds} n={n} models={models}>
        <Scorecards metrics={metrics} models={models} pValue={agree.pValue} speed={speed} nouns={nouns} />
      </Hero>

      <section className="band">
        <div className="wide">
          <Protocol ds={ds} sample={results.sample} />
        </div>
      </section>

      <article className="paper">
        <header className="paper-head">
          <p className="paper-kicker">Technical report · {monthYear(results.runAt)}</p>
          <h2 className="paper-title">
            {ds.paperTitle}
          </h2>
          <p className="paper-byline">
            Classy · run {day(results.runAt)} · AI SDK {results.sdk.ai} · n = {fmt(n)}
          </p>
        </header>

        <section className="abstract">
          <h3>Abstract</h3>
          <p>
            We compare <code>{J.id}</code>, an evaluation model that returns a structured choice with probabilities, against{" "}
            <code>{Q.id}</code>, a general-purpose generative model, on {fmt(n)} {ds.abstractSource}. Neither model saw the
            reference label. {J.name} labelled <strong>{pct(metrics.jev.accuracy)}</strong> of {nouns} correctly (95% CI {pct(metrics.jev.ci[0])}–{pct(metrics.jev.ci[1])})
            and {Q.name} <strong>{pct(metrics.qwen.accuracy)}</strong> ({pct(metrics.qwen.ci[0])}–{pct(metrics.qwen.ci[1])}).{" "}
            {tie
              ? "The two models tied."
              : `The ${gap.toFixed(1)}-point gap in favour of ${leader.name} is ${
                  significant ? "statistically significant" : "not statistically significant"
                } under an exact McNemar test on the ${fmt(disagreements)} ${nouns} where the models disagreed (${fmtP(agree.pValue)}).`}{" "}
            Both models missed the same {fmt(agree.bothWrong)} {nouns}; we publish all {fmt(n)} answers for inspection.
          </p>
        </section>

        <section id="results">
          <h3>
            <span className="sec">1</span>Headline accuracy
          </h3>
          <p>
            Accuracy is the share of all {fmt(n)} {nouns} labelled correctly; an answer that could not be parsed counts as wrong.
            Because the sample is exactly half positive and half negative, a coin flip scores 50%, and so does a model that always
            answers the same way.
          </p>
        </section>

        <figure className="figure">
          <AccuracyChart metrics={[metrics.jev, metrics.qwen]} models={models} />
          <figcaption>
            <strong>Figure 1.</strong> Accuracy with 95% Wilson score intervals [2]. Intervals are for each model on its own;
            the paired comparison is in Figure 4.
          </figcaption>
        </figure>

        <figure className="figure">
          <div className="table-wrap">
            <table className="metrics">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Accuracy</th>
                  <th scope="col">95% CI</th>
                  <th scope="col">Macro F1</th>
                  <th scope="col">Recall +</th>
                  <th scope="col">Recall −</th>
                  <th scope="col">No answer</th>
                  <th scope="col">Median latency</th>
                  <th scope="col">Tokens in / out</th>
                  <th scope="col">Expected cost / 1k</th>
                  <th scope="col">Billed / 1k</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const s = metrics[m.key];
                  return (
                    <tr key={m.key}>
                      <th scope="row">
                        <ModelSwatch k={m.key} />
                        {m.name}
                      </th>
                      <td>{pct(s.accuracy)}</td>
                      <td>
                        {pct(s.ci[0])}–{pct(s.ci[1])}
                      </td>
                      <td>{s.macroF1.toFixed(3)}</td>
                      <td>{pct(s.recall.positive)}</td>
                      <td>{pct(s.recall.negative)}</td>
                      <td>{s.unanswered}</td>
                      <td>{ms(medianResponse(m.key, s, speed))}</td>
                      <td>
                        {s.meanInputTokens === null || s.meanOutputTokens === null
                          ? "n/a"
                          : `${fmt(Math.round(s.meanInputTokens))} / ${fmt(Math.round(s.meanOutputTokens))}`}
                      </td>
                      <td>{usd(s.expectedCostPer1k)}</td>
                      <td>{usd(s.costPer1k)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <figcaption>
            <strong>Table 1.</strong> Recall + / − is accuracy on positive and on negative {nouns}.{" "}
            {speed ? (
              <>
                Median latency comes from a separate speed test of {fmt(speed.n)} {nouns} per model: one request at a time from one
                client through AI Gateway, each timed as a single attempt, with any request the gateway throttled discarded rather
                than retried (95th percentile: {models.map((m) => `${m.name} ${ms(speed.models[m.key].p95)}`).join(", ")}).
              </>
            ) : (
              <>
                Median latency is wall-clock per request during the accuracy run, from one client through AI Gateway, retries and
                rate-limit back-off included; treat it as indicative.
              </>
            )}{" "}
            Tokens are the mean per {noun}. Expected cost is
            those tokens at list price (
            {models
              .filter((m) => m.pricing)
              .map((m) => `${m.name} $${m.pricing!.inputPerMTok} in / $${m.pricing!.outputPerMTok} out`)
              .join("; ")}{" "}
            per million tokens), whatever free tier or credits apply. Billed is what AI Gateway charged this run
            {models
              .filter((m) => metrics[m.key].costPer1k === 0)
              .map((m) => `; ${m.name} was billed $0 on this account (free tier)`)
              .join("")}
            .
          </figcaption>
        </figure>

        <section>
          <h3>
            <span className="sec">2</span>Every verdict, one square each
          </h3>
          <p>
            Each square below is one {noun}, in the same position in both grids, so you can compare the two models {noun} by{" "}
            {noun}. Grey squares are correct and red squares are mistakes. Hover a square to see what each model said, or switch the
            highlight to the {nouns} where the models disagreed.
          </p>
        </section>

        <figure className="figure figure-wide">
          <Waffle cells={waffleCells} models={models} nouns={nouns} />
          <figcaption>
            <strong>Figure 2.</strong> All {fmt(n)} verdicts per model, grouped by the human label.
            {hasCsv && (
              <>
                {" "}
                Full per-{noun} answers are in the <a href={ds.csv}>CSV download</a>.
              </>
            )}
          </figcaption>
        </figure>

        <figure className="figure">
          <div className="cms">
            <ConfusionMatrix m={metrics.jev} info={J} nouns={nouns} />
            <ConfusionMatrix m={metrics.qwen} info={Q} nouns={nouns} />
          </div>
          <figcaption>
            <strong>Figure 3.</strong> Confusion matrices. Rows are the human label and columns are the model’s answer; shading is
            the share of the row. Errors off the diagonal show whether a model leans positive or negative.
          </figcaption>
        </figure>

        <section>
          <h3>
            <span className="sec">3</span>Where they disagree
          </h3>
          <p>
            Both models saw the same {nouns}, so the fair comparison is paired. The models agreed on{" "}
            {fmt(agree.bothRight + agree.bothWrong)} {nouns} ({pct((agree.bothRight + agree.bothWrong) / n)}) and disagreed on{" "}
            {fmt(disagreements)}. Only those disagreements tell the models apart, and McNemar’s test [3] asks whether they split
            more unevenly than chance would. {J.name} was right on {fmt(agree.onlyJev)} and {Q.name} on {fmt(agree.onlyQwen)} (
            {fmtP(agree.pValue)}).
            {!tie &&
              (significant
                ? ` At the 5% level, ${leader.name} is the more accurate model on this task.`
                : ` That is not enough evidence to say ${leader.name} is better than ${trailer.name} on this task.`)}
          </p>
        </section>

        <figure className="figure">
          <AgreementTable a={agree} models={models} nouns={nouns} />
          <figcaption>
            <strong>Figure 4.</strong> Paired outcomes. The off-diagonal cells are the discordant pairs used by the exact McNemar test.
          </figcaption>
        </figure>

        <section>
          <p>
            Does length matter? {ds.lengthIntro} Figure 5 splits the sample into five equal groups by word count.
          </p>
        </section>

        <figure className="figure">
          <Legend models={models} />
          <LengthChart buckets={lengths} models={models} noun={noun} nouns={nouns} />
          <details className="table-view">
            <summary>View as table</summary>
            <table className="metrics">
              <thead>
                <tr>
                  <th scope="col">Words</th>
                  <th scope="col">{cap(nouns)}</th>
                  {models.map((m) => (
                    <th scope="col" key={m.key}>
                      {m.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lengths.map((b) => (
                  <tr key={b.minWords}>
                    <th scope="row">
                      {b.minWords}–{b.maxWords}
                    </th>
                    <td>{b.n}</td>
                    {models.map((m) => (
                      <td key={m.key}>{pct(b.accuracy[m.key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <figcaption>
            <strong>Figure 5.</strong> Accuracy by {noun} length. Each group holds {lengths[0]?.n} {nouns}, so each point has a 95%
            interval of roughly ±{bucketHalfWidth.toFixed(0)} points. Read the trend, not single points.
          </figcaption>
        </figure>

        {cal && (
          <>
            <section>
              <h3>
                <span className="sec">4</span>Does {J.name} know when it’s wrong?
              </h3>
              <p>
                As an evaluation model, {J.name} returns a probability for each label, not just an answer. A well-calibrated model
                that says “90% sure” should be right about 90% of the time. Its average confidence was {pct(cal.meanWhenRight)} on
                answers it got right and {pct(cal.meanWhenWrong)} on answers it got wrong. The expected calibration error [4] is{" "}
                <strong>{(cal.ece * 100).toFixed(1)} points</strong>
                {cal.ece < 0.03
                  ? ", which is well calibrated."
                  : cal.ece < 0.08
                    ? ", which is reasonably calibrated."
                    : ", so its stated confidence should not be taken at face value."}{" "}
                {Q.name} returns only text, so it has no equivalent chart.
              </p>
            </section>
            <figure className="figure">
              <ReliabilityChart bins={cal.bins} total={cal.n} nouns={nouns} />
              <details className="table-view">
                <summary>View as table</summary>
                <table className="metrics">
                  <thead>
                    <tr>
                      <th scope="col">Confidence bin</th>
                      <th scope="col">{cap(nouns)}</th>
                      <th scope="col">Mean confidence</th>
                      <th scope="col">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cal.bins.map((b) => (
                      <tr key={b.lo}>
                        <th scope="row">
                          {pct(b.lo, 0)}–{pct(b.hi, 0)}
                        </th>
                        <td>{b.n}</td>
                        <td>{pct(b.confidence)}</td>
                        <td>{pct(b.accuracy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <figcaption>
                <strong>Figure 6.</strong> Reliability diagram for {J.name}, in 5-point confidence bins. Points below the diagonal
                are over-confident and points above it are under-confident.
              </figcaption>
            </figure>
          </>
        )}

        <section id="errors">
          <h3>
            <span className="sec">{cal ? 5 : 4}</span>Error analysis
          </h3>
          <p>
            Accuracy doesn’t show what the mistakes look like. These are the actual {nouns} the models got wrong, with the human
            label and each model’s answer.
          </p>
        </section>
        <div className="figure figure-wide">
          <Gallery tabs={tabs} models={models} noun={noun} />
        </div>

        {reference && (
          <ReferenceSection
            ds={ds}
            reference={reference}
            results={results}
            metrics={metrics}
            speed={speed}
            sectionNo={cal ? 6 : 5}
          />
        )}

        <Method ds={ds} results={results} unparsedNote={unparsedNote} sectionNo={(cal ? 6 : 5) + (reference ? 1 : 0)} />
      </article>
    </main>
  );
}

function ReferenceSection({
  ds,
  reference,
  results,
  metrics,
  speed,
  sectionNo,
}: {
  ds: Dataset;
  reference: ReferenceFile;
  results: ResultsFile;
  metrics: Record<ModelKey, ReturnType<typeof modelMetrics>>;
  speed: SpeedFile | null;
  sectionNo: number;
}) {
  const { noun, nouns } = ds;
  const refs = reference.references;
  const ids = refs[0].rows.map((r) => r.id);
  const n = ids.length;
  const label = new Map(refs[0].rows.map((r) => [r.id, r.label]));
  const byId = new Map(results.rows.map((r) => [r.id, r]));
  const subagentRefs = refs.filter((r) => r.via === "subagent");
  const subagentNames = subagentRefs.map((r) => r.model.name).join(" and ");
  const refLines = refs.map((ref) => {
    const R = ref.model;
    const est = ref.estimatedTokens;
    const cost =
      R.pricing && est
        ? ((est.inputPerReview * R.pricing.inputPerMTok + est.outputPerReview * R.pricing.outputPerMTok) / 1e6) * 1000
        : null;
    const right = ref.rows.filter((r) => r.answer.prediction === r.label).length;
    return {
      key: R.key,
      name: R.name,
      right,
      ci: wilson(right, n),
      speed: ref.via === "subagent" ? "not measured" : ms(quantileMs(ref.rows.map((r) => r.answer.latencyMs))),
      cost:
        ref.via === "local" ? "$0 (on-device)" : cost === null ? "n/a" : `${ref.via === "subagent" ? "≥ " : ""}${usd(cost)}`,
      price: R.pricing && ref.via === "subagent" ? `${R.name} $${R.pricing.inputPerMTok} in / $${R.pricing.outputPerMTok} out` : "",
    };
  });
  const lines = [
    ...refLines,
    ...results.models.map((m) => {
      const right = ids.filter((id) => byId.get(id)?.[m.key].prediction === label.get(id)).length;
      return {
        key: m.key,
        name: m.name,
        right,
        ci: wilson(right, n),
        speed: ms(medianResponse(m.key, metrics[m.key], speed)),
        cost: usd(metrics[m.key].expectedCostPer1k),
        price: "",
      };
    }),
  ];
  const est = refs.find((r) => r.estimatedTokens)?.estimatedTokens;
  const full = n === results.rows.length;
  const spread = Math.max(...lines.map((l) => l.right)) - Math.min(...lines.map((l) => l.right));
  return (
    <>
      <section id="reference">
        <h3>
          <span className="sec">{sectionNo}</span>Reference models on {fmt(n)} {nouns}
        </h3>
        <p>
          For scale, {refs.length > 1 ? `${["two", "three", "four", "five"][refs.length - 2] ?? refs.length} reference models` : "a reference model"} answered{" "}
          {full ? `all ${fmt(n)} ${nouns} of the sample` : `the first ${fmt(n)} ${nouns} of the same shuffled sample`}, with the same system
          prompt and {noun} template as {results.models[1].name} and without seeing the labels.{" "}
          {full ? (
            <>
              All {["two", "three", "four", "five", "six"][lines.length - 2] ?? lines.length} models land within {spread} {nouns} of each other, well inside one another’s 95% intervals, so on
              accuracy this task doesn’t separate them; cost and speed do.
            </>
          ) : (
            <>
              {fmt(n)} {nouns} is enough to place a model, not to rank it:{" "}
              {refLines
                .map(
                  (l) =>
                    `${l.name} scored ${pct(l.right / n)}, a 95% interval of ${pct(l.ci[0])}–${pct(l.ci[1])}, or roughly ${fmt(
                      Math.round(l.ci[0] * 1000),
                    )}–${fmt(Math.round(l.ci[1] * 1000))} right if extrapolated to 1,000 ${nouns}`,
                )
                .join("; ")}
              .
            </>
          )}
        </p>
      </section>
      <figure className="figure">
        <div className="table-wrap">
          <table className="metrics">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Correct</th>
                <th scope="col">Accuracy</th>
                <th scope="col">95% CI</th>
                <th scope="col">Median response</th>
                <th scope="col">Cost / 1k {nouns}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <th scope="row">
                    {l.key === "jev" || l.key === "qwen" ? <ModelSwatch k={l.key} /> : null}
                    {l.name}
                  </th>
                  <td>
                    {fmt(l.right)} / {fmt(n)}
                  </td>
                  <td>{pct(l.right / n)}</td>
                  <td>
                    {pct(l.ci[0])}–{pct(l.ci[1])}
                  </td>
                  <td>{l.speed}</td>
                  <td>{l.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <figcaption>
          <strong>Table 2.</strong> All models on the same {fmt(n)} {nouns}. Response times for{" "}
          {results.models.map((m) => m.name).join(" and ")} are from the speed test in Table 1; their costs are the full-run figures
          at list price.{" "}
          {subagentRefs.length > 0 && (
            <>
              {subagentNames} {subagentRefs.length > 1 ? "were" : "was"} run through Claude Code subagents rather than AI Gateway,
              because the gateway account’s free tier doesn’t include {subagentRefs.length > 1 ? "them" : "it"}. Each subagent got ten{" "}
              {nouns} to judge one by one and gave the same one-word answer, inside Claude Code’s own instructions, so this is close
              to, not identical with, a bare API call. There is no per-request timing, and cost is a lower-bound estimate at list
              price ({refLines.filter((l) => l.price).map((l) => l.price).join("; ")} per million tokens), with {est?.basis}.{" "}
            </>
          )}
          {refs.some((r) => r.via === "local") && (
            <>
              Models marked on-device ran locally with the same instructions and label definitions, posed as a single tool whose
              only argument is the label, one fresh request per {noun}; their response time is that machine’s, not a network
              round trip.{" "}
            </>
          )}
          {refs.some((r) => r.via === "api") && (
            <>Gateway reference models were called one request at a time; cost is measured tokens at list price. </>
          )}
          {refs.filter((r) => r.note).map((r) => `${r.note} `)}
        </figcaption>
      </figure>
    </>
  );
}

const quantileMs = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/**
 * Median response time: the throttle-free speed test when this dataset has one,
 * otherwise the accuracy run's own per-request latency (retries included).
 */
const medianResponse = (k: ModelKey, m: ReturnType<typeof modelMetrics>, speed: SpeedFile | null) =>
  speed ? speed.models[k].p50 : m.latency.p50;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The request template with its placeholder shown as "<review text>" / "<comment text>". */
const showTemplate = (template: string, noun: string) => template.replace(/\{\w+\}/, `<${noun} text>`);

function DataParagraph({ ds, s }: { ds: Dataset; s: Omit<SampleFile, "items"> }) {
  if (ds.key === "github") {
    const neutral = s.excluded?.find((e) => e.label === "neutral")?.count ?? 0;
    return (
      <p>
        <strong>Data.</strong> The GitHub sentiment gold standard [1] holds {fmt(s.populationSize + neutral + s.duplicatesRemoved)}{" "}
        comments on pull requests and commits from 90 repositories in the 2014 MSR Mining Challenge dataset, each labelled
        positive, negative or neutral by human annotators following written guidelines. We set aside the {fmt(neutral)} neutral
        comments to keep the task binary, undid a second layer of CSV quoting left by the dataset’s export (a stray closing
        quotation mark on most texts, doubled quotation marks inside them), dropped {fmt(s.duplicatesRemoved)} exact duplicate
        {s.duplicatesRemoved === 1 ? "" : "s"}, and drew {fmt(s.size / 2)} positive and {fmt(s.size / 2)} negative comments from the{" "}
        {fmt(s.populationSize)} that remained, with a seeded shuffle (seed {s.seed}). The source file is committed in{" "}
        <code>data/raw/github_gold.csv</code> and the sample in <code>data/github/sample.json</code>.
      </p>
    );
  }
  return (
    <p>
      <strong>Data.</strong> The IMDB Large Movie Review dataset [1] labels a review negative if its star rating is 4/10 or lower
      and positive if it is 7/10 or higher; mid-range reviews are excluded. From the 50,000-review distribution we dropped{" "}
      {fmt(s.duplicatesRemoved)} exact duplicates, converted <code>&lt;br /&gt;</code> tags to line breaks, and drew{" "}
      {fmt(s.size / 2)} positive and {fmt(s.size / 2)} negative reviews with a seeded shuffle (seed {s.seed}). The sample is
      committed in <code>data/sample.json</code>.
    </p>
  );
}

function Limitations({ ds }: { ds: Dataset }) {
  const shared = (
    <>
      <li>
        <strong>One run, one prompt.</strong> Results are from a single pass with one wording. Different instructions, few-shot
        examples or a different answer parser could move the numbers by a point or two.
      </li>
      <li>
        <strong>Different interfaces.</strong> The evaluation model answers in a fixed format; the chat model has to be parsed.
        That is part of what is being compared, not a flaw to correct for.
      </li>
    </>
  );
  if (ds.key === "github") {
    return (
      <ul className="limits">
        <li>
          <strong>An easier task than real use.</strong> Neutral comments, 43% of the gold standard, are left out. In a real
          repository most comments are neutral, so a two-way test overstates how well either model would triage live discussion.
        </li>
        <li>
          <strong>Labels are annotators’ readings of tone.</strong> Short comments are often ambiguous, and some of each model’s
          “errors” may be cases where a reasonable reader would disagree with the label; the gallery above is the place to check.
        </li>
        <li>
          <strong>Possible contamination.</strong> The comments were public on GitHub years before either model was trained, and
          the labelled dataset has been public since 2020.
        </li>
        {shared}
      </ul>
    );
  }
  return (
    <ul className="limits">
      <li>
        <strong>An easier task than real use.</strong> Excluding 5–6/10 reviews removes the genuinely ambivalent cases, so real
        product reviews will score lower.
      </li>
      <li>
        <strong>Labels come from star ratings, not the text.</strong> A reviewer can write something that reads like a pan and
        still give it 7 stars. Some of each model’s “errors” may be label noise; the gallery above is the place to check.
      </li>
      <li>
        <strong>Possible contamination.</strong> IMDB reviews have been public since 2011 and may be in either model’s training
        data.
      </li>
      {shared}
    </ul>
  );
}

function SourceReference({ ds }: { ds: Dataset }) {
  if (ds.key === "github") {
    return (
      <li>
        N. Novielli, F. Calefato, D. Dongiovanni, D. Girardi, F. Lanubile. Can We Use SE-specific Sentiment Analysis Tools in a
        Cross-Platform Setting? <em>MSR</em>, 2020. Dataset: “A gold standard for polarity of emotions of software developers in
        GitHub”,{" "}
        <a href="https://figshare.com/articles/dataset/A_gold_standard_for_polarity_of_emotions_of_software_developers_in_GitHub/11604597/1">
          figshare.com/articles/dataset/11604597
        </a>
        , licensed{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" rel="license">
          CC BY 4.0
        </a>
        . We removed the neutral comments, repaired the CSV quoting and drew a balanced sample.
      </li>
    );
  }
  return (
    <li>
      A. L. Maas, R. E. Daly, P. T. Pham, D. Huang, A. Y. Ng, C. Potts. Learning Word Vectors for Sentiment Analysis. <em>ACL</em>,
      2011. <a href="https://ai.stanford.edu/~amaas/data/sentiment/">ai.stanford.edu/~amaas/data/sentiment</a>
    </li>
  );
}

function Method({
  ds,
  results,
  unparsedNote,
  sectionNo,
}: {
  ds: Dataset;
  results: ResultsFile;
  unparsedNote: string;
  sectionNo: number;
}) {
  const [J, Q] = results.models;
  const s = results.sample;
  return (
    <>
      <section id="method">
        <h3>
          <span className="sec">{sectionNo}</span>Method
        </h3>
        <DataParagraph ds={ds} s={s} />
        <p>
          <strong>Blinding.</strong> A request contains only the {ds.noun} text, the task instructions and the two label
          definitions below. The reference label stays on disk and is joined back only when scoring.
        </p>
        <p>
          <strong>Models.</strong> Both models were called once per {ds.noun} through Vercel AI Gateway with the AI SDK (
          <code>ai@{results.sdk.ai}</code>). {J.name} is an evaluation model, called with <code>experimental_evaluate</code> and a
          single <code>choice</code> question; it returns the chosen label with a probability for each option. {Q.name} is a chat
          model, called with <code>generateText</code> at temperature 0. Its reply was matched against the words “positive” and
          “negative”, and a reply containing neither or both counted as no answer
          {unparsedNote ? ` (${unparsedNote})` : " (there were none)"}.
        </p>
      </section>

      <div className="figure">
        <div className="prompt">
          <div className="prompt-head">
            <ModelSwatch k="jev" /> {J.name} · <code>{J.id}</code>
          </div>
          <pre>
            {JSON.stringify(
              {
                state: `<${ds.noun} text>`,
                questions: {
                  sentiment: { type: "choice", instructions: results.prompt.instructions, criteria: results.prompt.criteria },
                },
              },
              null,
              2,
            )}
          </pre>
        </div>
        <div className="prompt">
          <div className="prompt-head">
            <ModelSwatch k="qwen" /> {Q.name} · <code>{Q.id}</code>
          </div>
          <pre>
            <span className="prompt-role">system</span>
            {"\n" + results.prompt.generativeSystem + "\n\n"}
            <span className="prompt-role">user</span>
            {"\n" + showTemplate(results.prompt.generativeTemplate, ds.noun)}
          </pre>
        </div>
        <p className="caption">
          <strong>Listing 1.</strong> The exact requests. Both models get the same instructions and label definitions.
        </p>
      </div>

      <section>
        <p>
          <strong>Statistics.</strong> Intervals are 95% Wilson score intervals [2]. The two models are compared with a two-sided
          exact McNemar test [3] (a binomial test on the discordant pairs). Calibration uses expected calibration error [4] over
          5-point bins of the evaluation model’s probability for its chosen label.
        </p>
        <h3>
          <span className="sec">{sectionNo + 1}</span>Limitations
        </h3>
        <Limitations ds={ds} />

        <h3>References</h3>
        <ol className="refs">
          <SourceReference ds={ds} />
          <li>
            E. B. Wilson. Probable inference, the law of succession, and statistical inference. <em>JASA</em> 22(158), 1927.
          </li>
          <li>
            Q. McNemar. Note on the sampling error of the difference between correlated proportions or percentages.{" "}
            <em>Psychometrika</em> 12(2), 1947.
          </li>
          <li>
            C. Guo, G. Pleiss, Y. Sun, K. Q. Weinberger. On Calibration of Modern Neural Networks. <em>ICML</em>, 2017.
          </li>
        </ol>

        <h3>Data &amp; reproduction</h3>
        <p>
          Every answer is filed in <code>{ds.dir}/results.json</code>
          {results.simulated ? "" : <> and in <a href={ds.csv}>{ds.csv.slice(1)}</a></>}, one row per {ds.noun}. The site is
          static and makes no model calls. To re-run:
        </p>
      </section>
      <div className="code-block">
        <pre className="code">{`npm install
cp .env.example .env.local        # add AI_GATEWAY_API_KEY
npm run eval${ds.evalArgs.padEnd(22)}# ${fmt(results.sample.size)} ${ds.nouns} × 2 models, resumable
npm run build`}</pre>
      </div>
    </>
  );
}

// ─── Before the one-time run ────────────────────────────────────────────────

function Pending({ ds, sample, models }: { ds: Dataset; sample: SampleFile; models: ModelInfo[] }) {
  const { items: _items, ...meta } = sample;
  return (
    <main>
      <Hero ds={ds} n={sample.size} models={models} pending>
        <div className="scorecards">
          {models.map((m) => (
            <div className={`scorecard sc-${m.key} pending`} key={m.key}>
              <div className="sc-head">
                <span className="sc-name">
                  <ModelSwatch k={m.key} />
                  {m.name}
                </span>
                <code className="sc-id">{m.id}</code>
              </div>
              <div className="sc-figure">—</div>
              <div className="sc-sub">Awaiting the one-time run</div>
            </div>
          ))}
        </div>
      </Hero>
      <section className="band">
        <div className="wide">
          <Protocol ds={ds} sample={meta} />
        </div>
      </section>
      <article className="paper" id="results">
        <section id="method">
          <h3>Results pending</h3>
          <p>
            The sample of {fmt(sample.size)} {ds.nouns} is ready in <code>{ds.dir}/sample.json</code>, but no answers have been
            filed yet. Run the benchmark once and redeploy:
          </p>
        </section>
        <div className="code-block" id="errors">
          <pre className="code">{`cp .env.example .env.local        # add AI_GATEWAY_API_KEY
npm run eval${ds.evalArgs.padEnd(22)}# writes ${ds.dir}/results.json + public${ds.csv}
git add ${ds.dir}/results.json public${ds.csv} && git commit -m "File benchmark results"`}</pre>
        </div>
        <section>
          <h3>References</h3>
          <ol className="refs">
            <SourceReference ds={ds} />
          </ol>
        </section>
      </article>
    </main>
  );
}

function Footer({ ds }: { ds: Dataset }) {
  return (
    <footer className="footer">
      <div className="wide">
        <span>
          Built with the AI SDK and Vercel AI Gateway. {ds.credit}
          {ds.key === "github" && (
            <>
              {" "}
              <a href="https://creativecommons.org/licenses/by/4.0/" rel="license">
                License
              </a>
              .
            </>
          )}
        </span>
        <a href="#top">Back to top ↑</a>
      </div>
    </footer>
  );
}
