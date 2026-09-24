"use client";

import { useMemo, useState } from "react";
import type { ModelInfo, ModelKey, Sentiment } from "@/lib/types";

/** 0 = correct, 1 = wrong, 2 = no usable answer */
type Verdict = 0 | 1 | 2;

export type WaffleCell = {
  id: string;
  label: Sentiment;
  jev: { v: Verdict; said: Sentiment | null };
  qwen: { v: Verdict; said: Sentiment | null };
  /** Opening of the review; only sent for cells where a model erred. */
  snippet?: string;
};

type Focus = "all" | "split" | "both-wrong";

const COLS = 50;
const PITCH = 12;
const SIZE = 10;

function agreeKind(c: WaffleCell) {
  const j = c.jev.v === 0;
  const q = c.qwen.v === 0;
  return j && q ? "both-right" : !j && !q ? "both-wrong" : "split";
}

function describe(name: string, p: { v: Verdict; said: Sentiment | null }) {
  if (p.v === 2) return `${name} gave no usable answer`;
  return `${p.v === 0 ? "✓" : "✕"} ${name} said ${p.said}`;
}

function Block({ cells, model, other }: { cells: WaffleCell[]; model: ModelInfo; other: ModelInfo }) {
  const rows = Math.ceil(cells.length / COLS);
  const k = model.key as ModelKey;
  const o = other.key as ModelKey;
  return (
    <svg
      className="waffle-svg"
      viewBox={`0 0 ${COLS * PITCH - (PITCH - SIZE)} ${rows * PITCH - (PITCH - SIZE)}`}
      role="img"
      aria-label={`${cells.length} ${cells[0]?.label} reviews: ${cells.filter((c) => c[k].v === 1).length} misclassified by ${model.name}`}
    >
      {cells.map((c, i) => {
        const lines = [
          describe(model.name, c[k]),
          `Actually ${c.label} · ${describe(other.name, c[o]).replace(/^[✓✕] /, "")} (${c[o].v === 0 ? "right" : "wrong"})`,
          c.id,
        ];
        if (c.snippet) lines.push(`“${c.snippet}…”`);
        return (
          <rect
            key={c.id}
            x={(i % COLS) * PITCH}
            y={Math.floor(i / COLS) * PITCH}
            width={SIZE}
            height={SIZE}
            rx={2}
            className={`cell v${c[k].v}`}
            data-agree={agreeKind(c)}
            data-tip={lines.join("\n")}
          />
        );
      })}
    </svg>
  );
}

export default function Waffle({ cells, models }: { cells: WaffleCell[]; models: ModelInfo[] }) {
  const [focus, setFocus] = useState<Focus>("all");
  const groups = useMemo(
    () => (["positive", "negative"] as const).map((label) => ({ label, cells: cells.filter((c) => c.label === label) })),
    [cells],
  );
  const counts = useMemo(() => {
    const split = cells.filter((c) => agreeKind(c) === "split").length;
    const bothWrong = cells.filter((c) => agreeKind(c) === "both-wrong").length;
    return { split, bothWrong };
  }, [cells]);

  const walls = useMemo(
    () =>
      models.map((m, idx) => {
        const other = models[1 - idx];
        const k = m.key as ModelKey;
        const wrong = cells.filter((c) => c[k].v !== 0).length;
        return (
          <div className="wall" key={m.key}>
            <div className="wall-head">
              <span className="wall-name">
                <span className={`swatch swatch-${m.key}`} aria-hidden />
                {m.name}
              </span>
              <span className="wall-errors">
                <strong>{wrong}</strong> missed
              </span>
            </div>
            {groups.map((g) => (
              <div key={g.label} className="wall-block">
                <div className="wall-block-label">
                  {g.label === "positive" ? "Positive reviews" : "Negative reviews"}
                  <span>{g.cells.length}</span>
                </div>
                <Block cells={g.cells} model={m} other={other} />
              </div>
            ))}
          </div>
        );
      }),
    [cells, groups, models],
  );

  const options: { key: Focus; label: string; count?: number }[] = [
    { key: "all", label: "Every review" },
    { key: "split", label: "They disagree", count: counts.split },
    { key: "both-wrong", label: "Both wrong", count: counts.bothWrong },
  ];

  return (
    <div className="waffle" data-focus={focus}>
      <div className="waffle-controls">
        <div className="seg" role="radiogroup" aria-label="Highlight">
          {options.map((o) => (
            <button
              key={o.key}
              role="radio"
              aria-checked={focus === o.key}
              className={focus === o.key ? "on" : ""}
              onClick={() => setFocus(o.key)}
            >
              {o.label}
              {o.count !== undefined && <span className="seg-count">{o.count}</span>}
            </button>
          ))}
        </div>
        <ul className="legend">
          <li>
            <span className="key key-ok" aria-hidden /> Correct
          </li>
          <li>
            <span className="key key-bad" aria-hidden />
            <span className="status-bad">✕</span> Wrong
          </li>
          <li>
            <span className="key key-none" aria-hidden /> No usable answer
          </li>
        </ul>
      </div>
      <div className="walls">{walls}</div>
    </div>
  );
}
