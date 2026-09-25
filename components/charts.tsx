import type { CalibrationBin, Agreement, LengthBucket, ModelMetrics } from "@/lib/stats";
import type { ModelInfo, ModelKey, Sentiment } from "@/lib/types";

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const fmt = (n: number) => n.toLocaleString("en-US");

export function ModelSwatch({ k }: { k: ModelKey }) {
  return <span className={`swatch swatch-${k}`} aria-hidden />;
}

export function Legend({ models }: { models: ModelInfo[] }) {
  return (
    <ul className="legend">
      {models.map((m) => (
        <li key={m.key}>
          <ModelSwatch k={m.key} />
          {m.name}
        </li>
      ))}
    </ul>
  );
}

// ─── Figure 1: accuracy with 95% CI ─────────────────────────────────────────

export function AccuracyChart({ metrics, models }: { metrics: ModelMetrics[]; models: ModelInfo[] }) {
  const lo = Math.min(...metrics.map((m) => m.ci[0]));
  // Snap the axis start to a clean 5-point step below the lowest interval.
  const min = Math.max(0.5, Math.floor(lo * 20 - 0.5) / 20);
  const ticks: number[] = [];
  for (let t = min; t <= 1.0001; t += 0.05) ticks.push(t);
  const x = (v: number) => `${((v - min) / (1 - min)) * 100}%`;

  return (
    <div className="dotwhisker">
      {metrics.map((m) => {
        const info = models.find((i) => i.key === m.key)!;
        return (
          <div className="dw-row" key={m.key}>
            <div className="dw-label">
              <ModelSwatch k={m.key} />
              <span>{info.name}</span>
            </div>
            <div className="dw-track">
              {ticks.map((t) => (
                <span key={t} className="dw-grid" style={{ left: x(t) }} />
              ))}
              <span
                className={`dw-whisker series-${m.key}`}
                style={{ left: x(m.ci[0]), width: `calc(${x(m.ci[1])} - ${x(m.ci[0])})` }}
              />
              <span
                className={`dw-dot series-${m.key}`}
                style={{ left: x(m.accuracy) }}
                tabIndex={0}
                data-tip={`${pct(m.accuracy)} accuracy\n${info.name}\n95% CI ${pct(m.ci[0])} – ${pct(m.ci[1])}\n${fmt(m.correct)} of ${fmt(m.n)} correct`}
              />
              <span className="dw-value" style={{ left: x(m.ci[1]) }}>
                {pct(m.accuracy)}
              </span>
            </div>
          </div>
        );
      })}
      <div className="dw-row dw-axis">
        <div />
        <div className="dw-track">
          {ticks.map((t) => (
            <span key={t} className="dw-tick" style={{ left: x(t) }}>
              {Math.round(t * 100)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Figure 3: confusion matrices ───────────────────────────────────────────

export function ConfusionMatrix({ m, info, nouns = "reviews" }: { m: ModelMetrics; info: ModelInfo; nouns?: string }) {
  const classes: Sentiment[] = ["positive", "negative"];
  const showNone = m.unanswered > 0;
  const cols: (Sentiment | "none")[] = showNone ? [...classes, "none"] : classes;
  return (
    <figure className="cm">
      <figcaption className="cm-title">
        <ModelSwatch k={m.key} />
        {info.name}
      </figcaption>
      <table>
        <thead>
          <tr>
            <th scope="col" className="cm-corner">
              actual ↓ &nbsp;predicted →
            </th>
            {cols.map((c) => (
              <th scope="col" key={c}>
                {c === "none" ? "no answer" : c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((actual) => {
            const rowTotal = cols.reduce((s, c) => s + m.confusion[actual][c], 0);
            return (
              <tr key={actual}>
                <th scope="row">{actual}</th>
                {cols.map((pred) => {
                  const v = m.confusion[actual][pred];
                  const share = rowTotal ? v / rowTotal : 0;
                  const right = pred === actual;
                  return (
                    <td
                      key={pred}
                      className={share > 0.5 ? "cm-strong" : "cm-weak"}
                      style={{ "--share": `${Math.round(Math.sqrt(share) * 100)}%` } as React.CSSProperties}
                      tabIndex={0}
                      data-tip={`${fmt(v)} ${nouns} (${pct(share)} of ${actual})\nActually ${actual}, ${
                        pred === "none" ? "no usable answer" : `${info.name} said ${pred}`
                      }\n${right ? "Correct" : "Error"}`}
                    >
                      <span className="cm-count">{fmt(v)}</span>
                      <span className="cm-share">{pct(share, 0)}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

// ─── Figure 4: paired agreement ─────────────────────────────────────────────

export function AgreementTable({ a, models, nouns = "reviews" }: { a: Agreement; models: ModelInfo[]; nouns?: string }) {
  const [j, q] = models;
  const total = a.bothRight + a.onlyJev + a.onlyQwen + a.bothWrong;
  const cell = (v: number, kind: string, tip: string) => (
    <td className={`ag-${kind}`} tabIndex={0} data-tip={`${fmt(v)} ${nouns} (${pct(v / total)})\n${tip}`}>
      <span className="ag-count">{fmt(v)}</span>
      <span className="ag-share">{pct(v / total)}</span>
    </td>
  );
  return (
    <table className="agree">
      <thead>
        <tr>
          <th className="cm-corner" />
          <th scope="col">
            <ModelSwatch k="qwen" /> {q.name} right
          </th>
          <th scope="col">
            <ModelSwatch k="qwen" /> {q.name} wrong
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">
            <ModelSwatch k="jev" /> {j.name} right
          </th>
          {cell(a.bothRight, "both", "Both models correct")}
          {cell(a.onlyJev, "jev", `Only ${j.name} correct`)}
        </tr>
        <tr>
          <th scope="row">
            <ModelSwatch k="jev" /> {j.name} wrong
          </th>
          {cell(a.onlyQwen, "qwen", `Only ${q.name} correct`)}
          {cell(a.bothWrong, "none", "Both models wrong")}
        </tr>
      </tbody>
    </table>
  );
}

// ─── Figure 5: accuracy by review length ────────────────────────────────────

export function LengthChart({
  buckets,
  models,
  noun = "review",
  nouns = "reviews",
}: {
  buckets: LengthBucket[];
  models: ModelInfo[];
  noun?: string;
  nouns?: string;
}) {
  const all = buckets.flatMap((b) => [b.accuracy.jev, b.accuracy.qwen]);
  const min = Math.max(0, Math.floor(Math.min(...all) * 20 - 0.5) / 20);
  const max = 1;
  const ticks: number[] = [];
  for (let t = min; t <= max + 1e-9; t += 0.05) ticks.push(t);
  const xAt = (i: number) => ((i + 0.5) / buckets.length) * 100;
  const yAt = (v: number) => (1 - (v - min) / (max - min)) * 100;

  return (
    <div className="xy">
      <div className="xy-plot" style={{ height: 260 }}>
        {ticks.map((t) => (
          <div key={t} className="xy-grid" style={{ top: `${yAt(t)}%` }}>
            <span>{Math.round(t * 100)}%</span>
          </div>
        ))}
        <svg className="xy-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {models.map((m) => (
            <polyline
              key={m.key}
              className={`line series-${m.key}`}
              points={buckets.map((b, i) => `${xAt(i)},${yAt(b.accuracy[m.key])}`).join(" ")}
            />
          ))}
        </svg>
        {buckets.map((b, i) =>
          models.map((m) => (
            <span
              key={`${i}-${m.key}`}
              className={`xy-dot series-${m.key}`}
              style={{ left: `${xAt(i)}%`, top: `${yAt(b.accuracy[m.key])}%` }}
              tabIndex={0}
              data-tip={`${pct(b.accuracy[m.key])} · ${m.name}\n${b.minWords}–${b.maxWords} words\n${b.n} ${nouns}`}
            />
          )),
        )}
        {models.map((m, i) => {
          const last = buckets[buckets.length - 1];
          const [a, b] = models.map((mm) => yAt(last.accuracy[mm.key]));
          // When the two end values nearly coincide, push the labels apart just enough not to overlap.
          const close = Math.abs(a - b) < 7;
          const upper = (i === 0 ? a <= b : b < a) ? -1 : 1;
          return (
            <span
              key={m.key}
              className="xy-endlabel"
              style={{
                left: `${xAt(buckets.length - 1)}%`,
                top: `calc(${yAt(last.accuracy[m.key])}% + ${close ? upper * 9 : 0}px)`,
              }}
            >
              {pct(last.accuracy[m.key])}
            </span>
          );
        })}
      </div>
      <div className="xy-xaxis">
        {buckets.map((b, i) => (
          <span key={i} style={{ left: `${xAt(i)}%` }}>
            {b.minWords}–<wbr />
            {b.maxWords}
          </span>
        ))}
      </div>
      <div className="xy-xtitle">{noun.charAt(0).toUpperCase() + noun.slice(1)} length, words (five equal-size groups of {buckets[0]?.n ?? 0})</div>
    </div>
  );
}

// ─── Figure 6: calibration of the evaluation model ──────────────────────────

export function ReliabilityChart({ bins, total, nouns = "reviews" }: { bins: CalibrationBin[]; total: number; nouns?: string }) {
  // x: stated confidence 50–100%. y: observed accuracy 0–100%.
  const x = (v: number) => ((v - 0.5) / 0.5) * 100;
  const y = (v: number) => (1 - v) * 100;
  const maxN = Math.max(...bins.map((b) => b.n));
  return (
    <div className="xy">
      <div className="xy-plot xy-square">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <div key={t} className="xy-grid" style={{ top: `${y(t)}%` }}>
            <span>{Math.round(t * 100)}%</span>
          </div>
        ))}
        <svg className="xy-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line className="diag" x1={x(0.5)} y1={y(0.5)} x2={x(1)} y2={y(1)} />
        </svg>
        <span className="xy-note" style={{ left: `${x(0.53)}%`, top: `${y(0.53)}%` }}>
          perfectly calibrated
        </span>
        {bins.map((b) => {
          const r = 5 + 11 * Math.sqrt(b.n / maxN);
          return (
            <span
              key={b.lo}
              className="xy-bubble series-jev"
              style={{ left: `${x(b.confidence)}%`, top: `${y(b.accuracy)}%`, width: r * 2, height: r * 2 }}
              tabIndex={0}
              data-tip={`${pct(b.accuracy)} actually correct\nStated confidence ${pct(b.lo, 0)}–${pct(b.hi, 0)} (mean ${pct(
                b.confidence,
              )})\n${b.n} ${nouns} (${pct(b.n / total)})`}
            />
          );
        })}
      </div>
      <div className="xy-xaxis">
        {[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((t) => (
          <span key={t} style={{ left: `${x(t)}%` }}>
            {Math.round(t * 100)}%
          </span>
        ))}
      </div>
      <div className="xy-xtitle">Jev’s probability for the label it chose · bubble area = number of {nouns}</div>
    </div>
  );
}
