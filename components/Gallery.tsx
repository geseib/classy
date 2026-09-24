"use client";

import { useId, useState } from "react";
import type { ModelInfo, Sentiment } from "@/lib/types";

export type GalleryItem = {
  id: string;
  label: Sentiment;
  text: string;
  words: number;
  jev: { said: Sentiment | null; confidence?: number };
  qwen: { said: Sentiment | null; raw?: string };
};

export type GalleryTab = {
  key: string;
  title: string;
  blurb: string;
  total: number;
  items: GalleryItem[];
};

function Verdict({ name, k, said, label, extra }: { name: string; k: string; said: Sentiment | null; label: Sentiment; extra?: string }) {
  const ok = said === label;
  return (
    <div className="verdict">
      <span className={`swatch swatch-${k}`} aria-hidden />
      <span className="verdict-name">{name}</span>
      <span className="verdict-said">{said ?? "no answer"}</span>
      {extra && <span className="verdict-extra">{extra}</span>}
      <span className={`badge ${ok ? "badge-ok" : "badge-bad"}`}>
        {ok ? "✓ right" : "✕ wrong"}
      </span>
    </div>
  );
}

function Card({ item, models }: { item: GalleryItem; models: ModelInfo[] }) {
  const [open, setOpen] = useState(false);
  const long = item.text.length > 520;
  const [j, q] = models;
  return (
    <article className="review">
      <header>
        <span className={`truth truth-${item.label}`}>
          {item.label === "positive" ? "👍" : "👎"} Human label: {item.label}
        </span>
        <span className="review-id">
          {item.id} · {item.words} words
        </span>
      </header>
      <p className={`review-text ${long && !open ? "clamped" : ""}`}>{item.text}</p>
      {long && (
        <button className="linklike" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Show less" : "Read the full review"}
        </button>
      )}
      <footer>
        <Verdict
          name={j.name}
          k="jev"
          said={item.jev.said}
          label={item.label}
          extra={item.jev.confidence !== undefined ? `${Math.round(item.jev.confidence * 100)}% sure` : undefined}
        />
        <Verdict
          name={q.name}
          k="qwen"
          said={item.qwen.said}
          label={item.label}
          extra={item.qwen.said === null && item.qwen.raw ? `“${item.qwen.raw.slice(0, 40)}”` : undefined}
        />
      </footer>
    </article>
  );
}

export default function Gallery({ tabs, models }: { tabs: GalleryTab[]; models: ModelInfo[] }) {
  const visible = tabs.filter((t) => t.items.length > 0);
  const [active, setActive] = useState(visible[0]?.key);
  const base = useId();
  const tab = visible.find((t) => t.key === active) ?? visible[0];
  if (!tab) return <p className="muted">Neither model made a mistake. Nothing to show here.</p>;

  return (
    <div className="gallery">
      <div className="seg" role="tablist" aria-label="Error categories">
        {visible.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`${base}-${t.key}`}
            aria-selected={t.key === tab.key}
            aria-controls={`${base}-panel`}
            className={t.key === tab.key ? "on" : ""}
            onClick={() => setActive(t.key)}
          >
            {t.title}
            <span className="seg-count">{t.total}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab.key}`}>
        <p className="gallery-blurb">
          {tab.blurb}
          {tab.total > tab.items.length && ` Showing ${tab.items.length} of ${tab.total}.`}
        </p>
        <div className="reviews">
          {tab.items.map((item) => (
            <Card key={item.id} item={item} models={models} />
          ))}
        </div>
      </div>
    </div>
  );
}
