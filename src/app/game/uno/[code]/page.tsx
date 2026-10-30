"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import UnoCard, { UNO_HEX, UnoBack, UnoCardT } from "@/components/UnoCard";
import { BaseRoom, ReactionBar, RoomHeader, Seat, useGameRoom } from "@/components/RoomKit";

type Ev = { type: string; seat?: Seat; card?: string; value?: string; color?: string; success?: boolean; seq: number };
type URoom = BaseRoom & {
  target: number; roundNo: number; matchPoints: { host: number; guest: number }; matchWinner: Seat | null;
  round: null | {
    top: UnoCardT; color: "r" | "y" | "g" | "b" | "w"; discardCount: number; deck: number; turn: Seat | null;
    myHand: UnoCardT[]; playable: string[]; oppCount: number;
    pending: null | { type: "wd4"; by: Seat } | { type: "color"; seat: Seat } | { type: "drawn"; seat: Seat; card: string };
    unoSafe: { host: boolean; guest: boolean }; canCatch: boolean; lastEvent: Ev | null;
    result: null | { winner: Seat; points: number; hand: UnoCardT[] };
  };
};

const COLOR_NAME: Record<string, string> = { r: "Đỏ", y: "Vàng", g: "Xanh lá", b: "Xanh dương" };
const tilt = (id: string) => ((id.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 25) - 12);

export default function UnoRoomPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || "").toUpperCase();
  const { room, seat, error, setError, peerLeft, reactions, emit } = useGameRoom<URoom>("uno", code);
  const [wildCard, setWildCard] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ seq: number; text: string; color: string } | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const prevHand = useRef<Set<string> | null>(null);
  const lastSeq = useRef(0);

  const R = room?.round ?? null;
  const opp: Seat | null = seat === "host" ? "guest" : seat === "guest" ? "host" : null;
  const myTurn = !!R && !R.result && R.turn === seat && !!room?.started;
  const mineSafe = !!(R && seat && R.unoSafe[seat]);

  // newly drawn cards fly in from the deck
  useEffect(() => {
    if (!R) return;
    const ids = R.myHand.map((c) => c.id);
    const prev = prevHand.current;
    prevHand.current = new Set(ids);
    if (!prev || prev.size === 0) return;
    const added = ids.filter((i) => !prev.has(i));
    if (added.length && added.length < 7) {
      setFresh(new Set(added));
      const t = window.setTimeout(() => setFresh(new Set()), 800);
      return () => window.clearTimeout(t);
    }
  }, [R]);

  // banners
  useEffect(() => {
    const ev = R?.lastEvent;
    if (!ev || ev.seq === lastSeq.current) return;
    lastSeq.current = ev.seq;
    const me = ev.seat === seat;
    let text = "", color = "#f8fafc";
    if (ev.type === "play") {
      if (ev.value === "skip") text = me ? "Đối thủ mất lượt!" : "Bạn mất lượt!";
      else if (ev.value === "reverse") text = me ? "Đổi chiều — bạn đi tiếp!" : "Đổi chiều — bạn mất lượt!";
      else if (ev.value === "draw2") text = me ? "Đối thủ +2!" : "Bạn bị +2!";
      else if (ev.value === "wild" || ev.value === "wild4") text = `Đổi màu: ${COLOR_NAME[ev.color || ""] || ""}${ev.value === "wild4" ? " · +4" : ""}`;
      if (ev.color) color = UNO_HEX[ev.color];
    } else if (ev.type === "draw4") text = me ? "Bạn nhận +4" : "Đối thủ nhận +4";
    else if (ev.type === "challenge") text = ev.success ? (me ? "Thách đấu thành công! Đối thủ +4" : "Bị bắt bài +4! Bạn bốc 4") : me ? "Thách đấu thất bại — bạn +6" : "Đối thủ thách đấu hụt — +6";
    else if (ev.type === "caught") text = me ? "Bị bắt lỗi UNO — bạn +2" : "Bắt lỗi UNO thành công! Đối thủ +2";
    else if (ev.type === "uno") { setBurst(ev.seq); window.setTimeout(() => setBurst((b) => (b === ev.seq ? null : b)), 1300); }
    if (text) {
      setBanner({ seq: ev.seq, text, color });
      const t = window.setTimeout(() => setBanner((b) => (b?.seq === ev.seq ? null : b)), 1800);
      return () => window.clearTimeout(t);
    }
  }, [R?.lastEvent, seat]);

  function playCard(c: UnoCardT) {
    if (!R || !myTurn || !R.playable.includes(c.id)) return;
    if (c.color === "w") { setWildCard(c.id); return; }
    emit("play", { card: c.id });
  }
  function chooseColor(col: string) {
    if (wildCard) emit("play", { card: wildCard, color: col });
    else emit("color", { color: col });
    setWildCard(null);
  }

  const needStartColor = !!(R?.pending?.type === "color" && R.pending.seat === seat);
  const wd4ToMe = !!(R?.pending?.type === "wd4" && R.turn === seat);
  const drawnPending = R?.pending?.type === "drawn" && R.pending.seat === seat;
  const showUno = !!R && !R.result && !mineSafe && (R.myHand.length === 1 || (R.myHand.length === 2 && myTurn));

  const status = (() => {
    if (!room || !R) return room?.started ? "" : "Chờ cả hai bấm Ready.";
    if (room.matchWinner) return room.matchWinner === seat ? "🏆 Bạn thắng trận!" : "Đối thủ thắng trận.";
    if (R.result) return "Hết ván.";
    if (wd4ToMe) return "Đối thủ đánh +4 — nhận hay thách đấu?";
    if (R.pending?.type === "wd4") return "Chờ đối thủ quyết định nhận +4 hay thách đấu…";
    if (needStartColor) return "Lá mở bài là Đổi màu — chọn màu.";
    if (drawnPending) return "Lá vừa bốc đánh được — đánh luôn hoặc giữ lại.";
    if (myTurn) return R.playable.length ? "Tới lượt bạn." : "Không có lá hợp lệ — bốc 1 lá.";
    return "Đợi đối thủ…";
  })();

  const n = R?.myHand.length ?? 0;
  const topFromMe = R?.lastEvent?.type === "play" && R.lastEvent.seat === seat;
  const fanSpread = Math.min(6, 40 / Math.max(1, n));

  const handSorted = useMemo(() => {
    const order = { r: 0, y: 1, g: 2, b: 3, w: 4 } as const;
    return [...(R?.myHand ?? [])].sort((a, b) => order[a.color] - order[b.color] || a.value.localeCompare(b.value, "en", { numeric: true }));
  }, [R?.myHand]);

  return (
    <div className="space-y-4">
      <RoomHeader title="UNO" code={code} room={room} seat={seat} peerLeft={peerLeft} emit={emit} over={!!room?.matchWinner} rematchLabel="Chơi trận mới" />
      {error && <p onClick={() => setError(null)} className="cursor-pointer rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {room && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-2 text-sm">
          <span>Ván {room.roundNo || "–"} · chơi tới <b>{room.target}</b></span>
          <span className="font-mono">Bạn <b className="text-emerald-300">{seat ? room.matchPoints[seat] : 0}</b> – <b className="text-rose-300">{opp ? room.matchPoints[opp] : 0}</b> Đối thủ</span>
        </div>
      )}

      {R && (
        <div className="relative overflow-hidden rounded-3xl border border-rose-900/50 bg-[radial-gradient(ellipse_at_center,#7f1d1d_0%,#450a0a_70%,#2a0505_100%)] px-3 pb-4 pt-3 shadow-inner">
          {/* opponent fan */}
          <div className="flex flex-col items-center">
            <div className="relative flex h-24 items-start justify-center">
              {Array.from({ length: R.oppCount }, (_, i) => {
                const mid = (R.oppCount - 1) / 2;
                return (
                  <div key={i} className="-mx-5 transition-transform duration-300" style={{ transform: `rotate(${180 + (i - mid) * fanSpread}deg) translateY(${Math.abs(i - mid) * 1.5}px)` }}>
                    <UnoBack w={46} />
                  </div>
                );
              })}
            </div>
            <p className={`mt-1 text-xs ${R.turn === opp ? "font-bold text-amber-300" : "text-rose-200/70"}`}>
              Đối thủ · {R.oppCount} lá {R.turn === opp && !R.result ? "• đang đi" : ""} {opp && R.unoSafe[opp] && R.oppCount === 1 ? "· UNO!" : ""}
            </p>
          </div>

          {/* centre: deck + discard */}
          <div className="my-4 flex items-center justify-center gap-10">
            <button type="button" disabled={!myTurn || !!R.pending} onClick={() => emit("draw")}
              className="btn-fx relative rounded-lg disabled:cursor-default" aria-label="Bốc bài" style={{ ["--glow" as string]: "rgb(250 204 21 / 0.6)" } as React.CSSProperties}>
              <div className="absolute left-1 top-1"><UnoBack w={70} /></div>
              <div className="relative"><UnoBack w={70} /></div>
              <span className="absolute -bottom-6 left-0 right-0 text-center text-xs text-rose-100/80">Nọc {R.deck}</span>
            </button>
            <div className="relative rounded-xl p-1.5 transition-shadow duration-500"
              style={{ boxShadow: `0 0 0 4px ${UNO_HEX[R.color] || "#fff"}, 0 0 28px 6px ${UNO_HEX[R.color] || "#fff"}88` }}>
              <div key={R.top.id} className="uno-fly"
                style={{ ["--fy" as string]: topFromMe ? "260px" : R.lastEvent?.type === "play" ? "-260px" : "0px", ["--tilt" as string]: `${tilt(R.top.id)}deg` } as React.CSSProperties}>
                <UnoCard card={R.top} w={70} />
              </div>
            </div>
          </div>

          {banner && (
            <div key={banner.seq} className="dm-pass pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
              <span className="rounded-2xl bg-slate-950/85 px-5 py-2 text-xl font-extrabold shadow-xl" style={{ color: banner.color === "#111" ? "#fff" : banner.color }}>{banner.text}</span>
            </div>
          )}
          {burst && (
            <div key={burst} className="uno-burst pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-6xl font-black italic text-[#f6c400]" style={{ WebkitTextStroke: "3px #111" }}>UNO!</span>
            </div>
          )}

          {/* my hand fan */}
          <div className="mt-8 flex flex-col items-center">
            <div className="flex min-h-[8rem] items-end justify-center px-6">
              {handSorted.map((c, i) => {
                const mid = (n - 1) / 2;
                const ok = myTurn && R.playable.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => playCard(c)}
                    className={`uno-hand -mx-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:-mx-2 ${fresh.has(c.id) ? "uno-draw" : ""} ${ok ? "uno-legal" : myTurn ? "opacity-45 saturate-50" : ""}`}
                    style={{ ["--rot" as string]: `${(i - mid) * fanSpread}deg`, ["--dy" as string]: `${Math.abs(i - mid) * 2}px` } as React.CSSProperties}
                    aria-label={`Lá ${c.color} ${c.value}`}>
                    <UnoCard card={c} w={62} />
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span className={`text-sm ${myTurn ? "font-bold text-emerald-300" : "text-rose-100/70"}`}>Bạn · {n} lá</span>
              {drawnPending && (
                <button type="button" onClick={() => emit("keep")} className="btn-fx rounded-xl border border-slate-500 bg-slate-900 px-3 py-1.5 text-sm">Giữ lá & bỏ lượt</button>
              )}
              {showUno && (
                <button type="button" onClick={() => emit("uno")} className="btn-fx rounded-full bg-[#f6c400] px-5 py-2 text-lg font-black italic text-slate-950 shadow-lg" style={{ ["--glow" as string]: "rgb(246 196 0 / 0.8)" } as React.CSSProperties}>UNO!</button>
              )}
              {R.canCatch && (
                <button type="button" onClick={() => emit("catch")} className="btn-fx animate-pulse rounded-xl bg-rose-500 px-4 py-2 text-sm font-bold text-white">Bắt lỗi UNO</button>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-center text-sm font-medium text-slate-200">{status}</p>

      {(wildCard || needStartColor) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
            <p className="mb-3 text-center font-semibold">Chọn màu</p>
            <div className="grid grid-cols-2 gap-3">
              {["r", "y", "g", "b"].map((c) => (
                <button key={c} type="button" onClick={() => chooseColor(c)} className="btn-fx h-20 w-24 rounded-xl text-sm font-bold text-white shadow"
                  style={{ backgroundColor: UNO_HEX[c], ["--glow" as string]: UNO_HEX[c] } as React.CSSProperties}>{COLOR_NAME[c]}</button>
              ))}
            </div>
            {wildCard && <button type="button" onClick={() => setWildCard(null)} className="btn-fx mt-3 w-full rounded-xl border border-slate-600 py-2 text-sm text-slate-300">Huỷ</button>}
          </div>
        </div>
      )}

      {wd4ToMe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
            <p className="font-semibold">Đối thủ đánh +4 (Đổi màu bốc 4)</p>
            <p className="mt-1 text-sm text-slate-400">Thách đấu: nếu đối thủ còn lá cùng màu cũ thì họ phải bốc 4. Nếu không, bạn bốc 6.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => emit("wd4", { challenge: false })} className="btn-fx flex-1 rounded-xl bg-slate-200 py-2 font-semibold text-slate-900">Nhận +4</button>
              <button type="button" onClick={() => emit("wd4", { challenge: true })} className="btn-fx flex-1 rounded-xl bg-rose-500 py-2 font-semibold text-white">Thách đấu</button>
            </div>
          </div>
        </div>
      )}

      {R?.result && (
        <div className="space-y-2 rounded-2xl border border-emerald-700/40 bg-slate-900/80 p-4">
          <p className="text-lg font-semibold text-emerald-200">{R.result.winner === seat ? `Bạn thắng ván +${R.result.points} điểm` : `Đối thủ thắng ván +${R.result.points} điểm`}</p>
          {R.result.hand.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs text-slate-400">
              Bài còn lại của {R.result.winner === seat ? "đối thủ" : "bạn"}:
              {R.result.hand.map((c) => <UnoCard key={c.id} card={c} w={30} />)}
            </div>
          )}
          {!room?.matchWinner && (
            <button type="button" onClick={() => emit("next-round")} className="btn-fx rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400">Ván tiếp theo</button>
          )}
        </div>
      )}

      <ReactionBar emit={emit} reactions={reactions} />
    </div>
  );
}
