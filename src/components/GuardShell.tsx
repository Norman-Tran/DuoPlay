"use client";

import { useEffect } from "react";

/**
 * Light deterrent against casual inspection/copying. NOT a security measure.
 * On by default in production; override with NEXT_PUBLIC_GUARD=0 / 1.
 * Game keys (letters, Enter, Backspace, arrows, Shift, Esc) are never touched.
 */
const FLAG = process.env.NEXT_PUBLIC_GUARD;
const ENABLED = FLAG != null && FLAG !== "" ? FLAG === "1" || FLAG === "true" : process.env.NODE_ENV === "production";

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.closest) return false;
  return Boolean(el.closest("input, textarea, [contenteditable], .select-text"));
}

export default function GuardShell() {
  useEffect(() => {
    if (!ENABLED) return;
    const onContext = (e: MouseEvent) => {
      if (!isEditable(e.target)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (
        e.key === "F12" ||
        (mod && e.shiftKey && (k === "i" || k === "j" || k === "c")) ||
        (mod && !e.shiftKey && (k === "u" || k === "s"))
      ) {
        e.preventDefault();
      }
    };
    const onDrag = (e: DragEvent) => {
      const el = e.target as Element | null;
      if (!el || !el.closest) return;
      if (el.closest("[draggable='true']")) return; // game drag & drop (e.g. domino tiles)
      if (el.closest("img, svg")) e.preventDefault();
    };
    const onSelect = (e: Event) => {
      if (!isEditable(e.target)) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("dragstart", onDrag);
    document.addEventListener("selectstart", onSelect);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("dragstart", onDrag);
      document.removeEventListener("selectstart", onSelect);
    };
  }, []);
  return null;
}
