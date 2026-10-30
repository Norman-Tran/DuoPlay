import Link from "next/link";
import type { CSSProperties } from "react";
import { GAMES } from "@/lib/games";
import GameIcon from "@/components/GameIcon";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-fuchsia-950/40 p-8 shadow-xl shadow-fuchsia-950/20">
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-cyan-400/80">Arcade cho hai người</p>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
          Chơi cùng bạn bè — <span className="text-fuchsia-300">một phòng, một mã</span>
        </h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Tạo phòng, gửi mã 6 ký tự cho bạn, vào chơi realtime. Đang có Cờ Caro, Cờ vua, Dò mìn đua tốc độ và Bida lỗ; các game khác sẽ mở dần.
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-200">Chọn game</h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {GAMES.map((game, idx) => {
            const style = { "--glow": game.glow, animationDelay: `${idx * 80}ms` } as CSSProperties;
            const card = (
              <div
                className={`h-full rounded-2xl border p-5 transition-colors duration-200 ${
                  game.status === "playable"
                    ? "border-slate-700/70 bg-slate-900/80 group-hover:bg-slate-900"
                    : "border-slate-800 bg-slate-900/40 opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <GameIcon id={game.id} />
                    <h3 className="mt-2 text-lg font-semibold">{game.name}</h3>
                    <p className="mt-1 text-sm text-slate-400">{game.blurb}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      game.status === "playable"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-slate-700/50 text-slate-400"
                    }`}
                  >
                    {game.status === "playable" ? "Chơi được" : "Sắp ra mắt"}
                  </span>
                </div>
              </div>
            );

            if (game.status === "playable" && game.href) {
              return (
                <li key={game.id} className="card-enter" style={style}>
                  <Link href={game.href} className="card-fx group h-full" style={style}>
                    {card}
                  </Link>
                </li>
              );
            }
            return (
              <li key={game.id} className="card-enter group" style={style}>
                {card}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
