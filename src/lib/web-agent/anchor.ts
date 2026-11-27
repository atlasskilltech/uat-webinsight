import type { CSSProperties } from "react";

/**
 * Edge-anchored placement for the floating Web Insight Agent widget.
 *
 * The widget's position is stored pinned to its NEAREST horizontal + vertical
 * edge (e.g. 20px from the right and bottom), not as an absolute top-left. CSS
 * then keeps it that same distance from its corner through any window resize,
 * minimise, maximise or rotate — so it never drifts or disappears. These
 * helpers are pure (viewport + element size are passed in) so they can be unit
 * tested without a DOM.
 */
export type Anchored = { hx: "left" | "right"; x: number; vy: "top" | "bottom"; y: number };

/** Minimum distance kept from any screen edge. */
export const GAP = 8;

/** Default placement: bottom-right, 20px in. */
export const DEFAULT_POS: Anchored = { hx: "right", x: 20, vy: "bottom", y: 20 };

/** Inline style that pins the element to its anchored edges. */
export function anchoredStyle(a: Anchored): CSSProperties {
  const s: CSSProperties = {};
  if (a.hx === "left") { s.left = a.x; s.right = "auto"; } else { s.right = a.x; s.left = "auto"; }
  if (a.vy === "top") { s.top = a.y; s.bottom = "auto"; } else { s.bottom = a.y; s.top = "auto"; }
  return s;
}

/**
 * Turn a desired top-left (px) + element size into an on-screen, edge-anchored
 * position: clamp inside the viewport, then anchor to whichever edge is nearest
 * so it stays in that corner on resize.
 */
export function toAnchored(left: number, top: number, w: number, h: number, vw: number, vh: number): Anchored {
  const L = Math.min(Math.max(GAP, left), Math.max(GAP, vw - w - GAP));
  const T = Math.min(Math.max(GAP, top), Math.max(GAP, vh - h - GAP));
  const hx = L + w / 2 > vw / 2 ? "right" : "left";
  const vy = T + h / 2 > vh / 2 ? "bottom" : "top";
  return {
    hx, x: hx === "right" ? Math.max(GAP, vw - (L + w)) : L,
    vy, y: vy === "bottom" ? Math.max(GAP, vh - (T + h)) : T,
  };
}

/**
 * Re-clamp an anchored position so the element stays fully on-screen after a
 * resize: the edge offset can never exceed what keeps the element + GAP inside
 * the viewport. Keeps the widget visible when a position saved on a big screen
 * is restored on a small one, or the window is shrunk.
 */
export function clampAnchored(a: Anchored, w: number, h: number, vw: number, vh: number): Anchored {
  const maxX = Math.max(GAP, vw - w - GAP);
  const maxY = Math.max(GAP, vh - h - GAP);
  return { ...a, x: Math.min(Math.max(GAP, a.x), maxX), y: Math.min(Math.max(GAP, a.y), maxY) };
}

/** Type guard for stored positions (rejects the old {x,y} top-left format). */
export function isAnchored(v: unknown): v is Anchored {
  const a = v as Anchored | null;
  return !!a && (a.hx === "left" || a.hx === "right") && (a.vy === "top" || a.vy === "bottom")
    && typeof a.x === "number" && typeof a.y === "number";
}
