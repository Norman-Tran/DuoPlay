"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BackLink from "@/components/BackLink";
import { GAMES } from "@/lib/games";

/** Fixed top bar, identical position on every page: logo + breadcrumb buttons. */
export default function TopNav() {
  const path = usePathname() || "/";
  const m = path.match(/^\/game\/([a-z]+)(\/[^/]+)?/);
  const game = m ? GAMES.find((g) => g.id === m[1]) : null;
  const inRoom = Boolean(m && m[2]);
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-slate-800/70 bg-slate-950/75 backdrop-blur">
      <nav className="flex h-14 items-center gap-2 px-4 sm:gap-3" aria-label="Điều hướng">
        <Link href="/" className="mr-1 shrink-0 rounded-lg text-xl font-bold tracking-tight text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
          Duo<span className="text-fuchsia-300">Play</span>
        </Link>
        {m && (
          <BackLink href="/" arrow={false}>
            <span aria-hidden="true">🏠</span> Trang chủ
          </BackLink>
        )}
        {inRoom && game && <BackLink href={`/game/${game.id}`}>Lobby {game.name}</BackLink>}
        <span className="ml-auto hidden text-xs text-slate-400 sm:inline">Chơi chung · 2 người</span>
      </nav>
    </header>
  );
}
