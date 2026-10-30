"use client";

import { usePathname } from "next/navigation";

/** Route-driven, low-contrast page background (gradient + one faint ambient layer). */
export default function GameBackground() {
  const path = usePathname() || "/";
  const m = path.match(/^\/game\/([a-z]+)/);
  const theme = m ? m[1] : "home";
  return (
    <div aria-hidden="true" className={`game-bg game-bg-${theme}`}>
      <div className="game-bg-pattern" />
      <div className="game-bg-blob game-bg-blob-a" />
      <div className="game-bg-blob game-bg-blob-b" />
    </div>
  );
}
