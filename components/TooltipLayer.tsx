"use client";

import { useEffect, useRef } from "react";

/**
 * One floating tooltip for the whole page. Any element with `data-tip` gets it
 * on hover and keyboard focus. Lines are split on "\n": the first line is the
 * value (strong), the rest are context. Content is set with textContent.
 */
export default function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tip = ref.current!;
    let active: Element | null = null;

    const show = (el: Element, x: number, y: number) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      if (active !== el) {
        active = el;
        tip.replaceChildren(
          ...text.split("\n").map((line, i) => {
            const div = document.createElement("div");
            div.className = i === 0 ? "tip-value" : "tip-line";
            div.textContent = line;
            return div;
          }),
        );
      }
      tip.hidden = false;
      const { width, height } = tip.getBoundingClientRect();
      const pad = 12;
      let left = x + pad;
      let top = y + pad;
      if (left + width > window.innerWidth - 8) left = x - width - pad;
      if (top + height > window.innerHeight - 8) top = y - height - pad;
      tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
    };
    const hide = () => {
      active = null;
      tip.hidden = true;
    };

    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]");
      if (el) show(el, e.clientX, e.clientY);
      else if (active) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.bottom);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide);
    };
  }, []);

  return <div ref={ref} className="tooltip" role="tooltip" hidden />;
}
