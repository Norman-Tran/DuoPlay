import Link from "next/link";
import { GAMES } from "@/lib/games";

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
          {GAMES.map((game) => {
            const card = (
              <div
                className={`rounded-2xl border p-5 transition ${
                  game.status === "playable"
                    ? "border-cyan-700/50 bg-slate-900/80 hover:border-cyan-400/70 hover:bg-slate-900"
                    : "border-slate-800 bg-slate-900/40 opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-3xl">{game.emoji}</div>
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
                <li key={game.id}>
                  <Link
                    href={game.href}
                    className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    {card}
                  </Link>
                </li>
              );
            }
            return <li key={game.id}>{card}</li>;
          })}
        </ul>
      </section>
    </div>
  );
}
