"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BaseRoom, ReactionBar, RoomHeader, useGameRoom } from "@/components/RoomKit";

type Col = "black" | "white";
type GRoom = BaseRoom & {
  size: number; komi: number; clockKey: string; clockLabel: string; periodMs: number; myColor: Col | null;
  board: number[]; moveNo: number[]; turn: Col; moves: number;
  lastMove: null | { x?: number; y?: number; pass?: boolean; color?: Col; n: number }; lastCaptured: number[];
  captures: { black: number; white: number };
  phase: "play" | "mark" | "over"; dead: number[]; accepted: { black: boolean; white: boolean }; illegal: number[];
  provisional: null | { black: number; white: number; owner: number[]; winner: Col; margin: number };
  result: null | { winner: Col; reason: "score" | "resign" | "timeout"; black?: number; white?: number; margin?: number; owner?: number[] };
  clock: null | { black: { main: number; periods: number }; white: { main: number; periods: number }; running: Col | null; elapsedMs: number };
};

const CELL = 32;
const LETTERS = "ABCDEFGHJKLMNOPQRST"; // Go coordinates skip I
const hoshi = (n: number) =>
  n === 9 ? [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]] : n === 13 ? [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]]
    : [3, 9, 15].flatMap((x) => [3, 9, 15].map((y) => [x, y]));
const VN: Record<Col, string> = { black: "Đen", white: "Trắng" };

function fmt(ms: number) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export default function GoRoomPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || "").toUpperCase();
  const { room, seat, error, setError, peerLeft, reactions, emit } = useGameRoom<GRoom>("go", code);
  const [hover, setHover] = useState<number | null>(null);
  const [showNums, setShowNums] = useState(false);
  const [fading, setFading] = useState<{ i: number; c: number }[]>([]);
  const prevBoard = useRef<number[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const recvAt = useRef(Date.now());

  useEffect(() => {
    recvAt.current = Date.now();
    if (!room) return;
    const prev = prevBoard.current;
    prevBoard.current = room.board;
    if (prev && prev.length === room.board.length && room.lastCaptured?.length) {
      const f = room.lastCaptured.filter((i) => prev[i]).map((i) => ({ i, c: prev[i] }));
      if (f.length) {
        setFading(f);
        const t = window.setTimeout(() => setFading([]), 500);
        return () => window.clearTimeout(t);
      }
    }
  }, [room]);
  useEffect(() => {
    if (!room?.clock?.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [room?.clock?.running, room]);

  const N = room?.size ?? 19;
  const pad = CELL * 1.2;
  const W = pad * 2 + CELL * (N - 1);
  const px = (k: number) => pad + k * CELL;
  const myTurn = !!room && room.phase === "play" && room.started && room.turn === room.myColor;
  const illegal = useMemo(() => new Set(room?.illegal ?? []), [room?.illegal]);
  const dead = useMemo(() => new Set(room?.dead ?? []), [room?.dead]);
  const owner = room?.phase === "over" ? room.result?.owner : room?.phase === "mark" ? room.provisional?.owner : undefined;
  const lm = room?.lastMove && !room.lastMove.pass ? room.lastMove : null;

  function clockOf(c: Col) {
    if (!room?.clock) return null;
    const s = room.clock[c];
    let main = s.main, periods = s.periods, period = room.periodMs;
    if (room.clock.running === c && room.phase === "play") {
      let el = room.clock.elapsedMs + (now - recvAt.current);
      if (main > el) main -= el;
      else { el -= main; main = 0; const lost = Math.floor(el / period); periods -= lost; period = period - (el - lost * period); }
    }
    return { main, periods: Math.max(0, periods), period };
  }

  function clickPoint(i: number) {
    if (!room) return;
    const x = i % N, y = (i / N) | 0;
    if (room.phase === "mark") { if (room.board[i]) emit("toggle", { x, y }); return; }
    if (!myTurn || room.board[i] || illegal.has(i)) return;
    emit("play", { x, y });
  }

  const status = (() => {
    if (!room) return "Đang kết nối…";
    if (room.result) {
      const r = room.result;
      const me = r.winner === room.myColor;
      const why = r.reason === "resign" ? "đối phương xin thua" : r.reason === "timeout" ? "đối phương hết giờ" : `${VN.black} ${r.black} – ${VN.white} ${r.white} (thắng ${r.margin} điểm)`;
      return `${me ? "🎉 Bạn thắng" : "Bạn thua"} — ${VN[r.winner]} thắng: ${why}`;
    }
    if (!room.started) return "Chờ cả hai bấm Ready.";
    if (room.phase === "mark") return "Hai bên đã bỏ lượt: bấm vào nhóm quân chết để đánh dấu, rồi bấm Đồng ý.";
    const p = room.lastMove?.pass ? `${VN[room.lastMove.color as Col]} vừa bỏ lượt. ` : "";
    return p + (myTurn ? "Tới lượt bạn." : `Lượt của ${VN[room.turn]}.`);
  })();

  const Side = ({ c }: { c: Col }) => {
    const ck = clockOf(c);
    const running = room?.clock?.running === c && room.phase === "play";
    const low = ck && ck.main === 0 && ck.period < 10_000;
    return (
      <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${room?.turn === c && room.phase === "play" ? "border-cyan-400 bg-slate-800" : "border-slate-700 bg-slate-900/70"}`}>
        <span className={`h-6 w-6 rounded-full ${c === "black" ? "go-stone-b" : "go-stone-w"}`} />
        <div className="flex-1 text-sm">
          <b>{VN[c]}</b> {room?.myColor === c ? "(Bạn)" : "(Đối thủ)"}
          <span className="block text-xs text-slate-400">Bắt được: {room?.captures[c] ?? 0}{c === "white" ? ` · komi ${room?.komi}` : ""}</span>
        </div>
        {ck && (
          <span className={`rounded-lg px-2 py-1 font-mono text-lg font-bold tabular-nums ${low ? "animate-pulse bg-rose-600 text-white" : running ? "bg-slate-100 text-slate-900" : "bg-slate-950 text-slate-400"}`}>
            {ck.main > 0 ? fmt(ck.main) : `${fmt(ck.period)} ×${ck.periods}`}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <RoomHeader title="Cờ vây" code={code} room={room} seat={seat} peerLeft={peerLeft} emit={emit} over={room?.phase === "over"} rematchLabel="Chơi lại (đổi màu)" />
      {error && <p onClick={() => setError(null)} className="cursor-pointer rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>}
      <p className="text-center text-sm font-medium text-slate-200">{status}</p>

      {room && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="mx-auto w-full max-w-[min(92vw,720px)]">
            <svg viewBox={`0 0 ${W} ${W}`} className="go-board block w-full rounded-lg shadow-2xl" onMouseLeave={() => setHover(null)}>
              <defs>
                <radialGradient id="gb" cx="35%" cy="30%" r="70%"><stop offset="0%" stopColor="#5a5a5a" /><stop offset="45%" stopColor="#1c1c1c" /><stop offset="100%" stopColor="#050505" /></radialGradient>
                <radialGradient id="gw" cx="35%" cy="30%" r="75%"><stop offset="0%" stopColor="#ffffff" /><stop offset="70%" stopColor="#ebe7dc" /><stop offset="100%" stopColor="#b9b2a2" /></radialGradient>
                <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#e9bf72" /><stop offset="50%" stopColor="#dcae5d" /><stop offset="100%" stopColor="#c99748" /></linearGradient>
                <pattern id="grain" width="160" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(4)">
                  <path d="M0 3 Q40 1 80 4 T160 3" fill="none" stroke="rgba(120,70,20,0.13)" strokeWidth="1.4" />
                  <path d="M0 9 Q50 11 90 8 T160 9" fill="none" stroke="rgba(120,70,20,0.08)" strokeWidth="1" />
                </pattern>
                <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="1.2" dy="1.8" stdDeviation="1.2" floodOpacity="0.45" /></filter>
              </defs>
              <rect width={W} height={W} fill="url(#wood)" />
              <rect width={W} height={W} fill="url(#grain)" />
              {Array.from({ length: N }, (_, k) => (
                <g key={k} stroke="#3b2a12" strokeWidth={k === 0 || k === N - 1 ? 1.6 : 0.9}>
                  <line x1={px(0)} y1={px(k)} x2={px(N - 1)} y2={px(k)} />
                  <line x1={px(k)} y1={px(0)} x2={px(k)} y2={px(N - 1)} />
                </g>
              ))}
              {hoshi(N).map(([x, y]) => <circle key={`${x}-${y}`} cx={px(x)} cy={px(y)} r={3.4} fill="#3b2a12" />)}
              {Array.from({ length: N }, (_, k) => (
                <g key={`c${k}`} fontSize={10} fill="#5b4018" fontWeight={600} textAnchor="middle">
                  <text x={px(k)} y={pad * 0.45}>{LETTERS[k]}</text>
                  <text x={px(k)} y={W - pad * 0.25}>{LETTERS[k]}</text>
                  <text x={pad * 0.4} y={px(k) + 3.5}>{N - k}</text>
                  <text x={W - pad * 0.4} y={px(k) + 3.5}>{N - k}</text>
                </g>
              ))}
              {owner && owner.map((o, i) => {
                if (!o || (room.board[i] && !dead.has(i))) return null;
                const x = px(i % N), y = px((i / N) | 0);
                return <rect key={`t${i}`} x={x - 5} y={y - 5} width={10} height={10} className="go-terr" fill={o === 1 ? "#111" : "#f8f8f8"} stroke={o === 1 ? "#f8f8f8" : "#111"} strokeWidth={0.6} />;
              })}
              {fading.map(({ i, c }) => (
                <circle key={`f${i}-${room.moves}`} className="go-cap" cx={px(i % N)} cy={px((i / N) | 0)} r={CELL * 0.47} fill={c === 1 ? "url(#gb)" : "url(#gw)"} />
              ))}
              {room.board.map((c, i) => {
                if (!c) return null;
                const x = px(i % N), y = px((i / N) | 0);
                const isLast = lm && lm.x === i % N && lm.y === ((i / N) | 0);
                return (
                  <g key={`s${i}-${room.moveNo[i]}`} className={isLast ? "go-drop" : ""} opacity={dead.has(i) ? 0.45 : 1}>
                    <circle cx={x} cy={y} r={CELL * 0.47} fill={c === 1 ? "url(#gb)" : "url(#gw)"} filter="url(#sh)" />
                    {showNums && room.moveNo[i] > 0 ? (
                      <text x={x} y={y + 4} textAnchor="middle" fontSize={room.moveNo[i] > 99 ? 9 : 11} fontWeight={700} fill={c === 1 ? "#fff" : "#111"}>{room.moveNo[i]}</text>
                    ) : isLast ? (
                      <circle cx={x} cy={y} r={CELL * 0.17} fill="none" stroke={c === 1 ? "#fff" : "#111"} strokeWidth={2} />
                    ) : null}
                    {dead.has(i) && <path d={`M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}`} stroke="#e11d48" strokeWidth={2.4} />}
                  </g>
                );
              })}
              {myTurn && hover !== null && !room.board[hover] && !illegal.has(hover) && (
                <circle cx={px(hover % N)} cy={px((hover / N) | 0)} r={CELL * 0.47} fill={room.myColor === "black" ? "url(#gb)" : "url(#gw)"} opacity={0.5} pointerEvents="none" />
              )}
              {Array.from({ length: N * N }, (_, i) => (
                <rect key={`h${i}`} x={px(i % N) - CELL / 2} y={px((i / N) | 0) - CELL / 2} width={CELL} height={CELL} fill="transparent"
                  className={myTurn || room.phase === "mark" ? "cursor-pointer" : ""}
                  onMouseEnter={() => setHover(i)} onClick={() => clickPoint(i)} />
              ))}
            </svg>
          </div>

          <div className="w-full space-y-2 lg:w-72">
            <Side c={room.myColor === "black" ? "white" : "black"} />
            <Side c={room.myColor === "black" ? "black" : "white"} />
            <p className="text-xs text-slate-500">{room.size}×{room.size} · luật tính diện tích (Trung Quốc) · {room.clockLabel} · nước {room.moves}</p>
            {room.phase === "play" && room.started && (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!myTurn} onClick={() => emit("pass")} className="btn-fx rounded-xl border border-slate-500 bg-slate-900 px-4 py-2 text-sm font-semibold disabled:opacity-40">Bỏ lượt</button>
                <button type="button" onClick={() => { if (window.confirm("Xin thua ván này?")) emit("resign"); }} className="btn-fx rounded-xl border border-rose-500/60 bg-rose-950/50 px-4 py-2 text-sm font-semibold text-rose-200">Xin thua</button>
              </div>
            )}
            {room.phase === "mark" && (
              <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-sm">
                <p>Tạm tính: Đen <b>{room.provisional?.black}</b> – Trắng <b>{room.provisional?.white}</b></p>
                <p className="text-xs text-amber-200/80">Đồng ý: Đen {room.accepted.black ? "✅" : "⏳"} · Trắng {room.accepted.white ? "✅" : "⏳"} (đổi đánh dấu thì phải đồng ý lại)</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => emit("accept")} className="btn-fx rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950">Đồng ý kết quả</button>
                  <button type="button" onClick={() => emit("resume")} className="btn-fx rounded-xl border border-slate-500 px-3 py-2 text-slate-200">Đánh tiếp</button>
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={showNums} onChange={(e) => setShowNums(e.target.checked)} /> Hiện số thứ tự nước đi
            </label>
          </div>
        </div>
      )}

      <ReactionBar emit={emit} reactions={reactions} />
    </div>
  );
}
