"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import DominoTile, { TileShape } from "@/components/DominoTile";
import { BaseRoom, ReactionBar, RoomHeader, Seat, useGameRoom } from "@/components/RoomKit";
import { ChainTile, layoutChain } from "@/lib/dominoLayout";

type Side = "left" | "right" | "any";
type DRoom = BaseRoom & {
  target: number;
  roundNo: number;
  matchPoints: { host: number; guest: number };
  matchWinner: Seat | null;
  round: null | {
    chain: ChainTile[];
    anchor: number;
    ends: { left: number; right: number } | null;
    turn: Seat | null;
    mustLead: string | null;
    boneyard: number;
    myHand: string[];
    oppCount: number;
    canPlay: boolean;
    lastEvent: { type: "play" | "draw" | "pass"; seat: Seat; tile?: string; side?: string; seq: number } | null;
    result: null | {
      winner: Seat | null; points: number; reason: "domino" | "blocked";
      pips: { host: number; guest: number }; hands: { host: number[][]; guest: number[][] };
    };
  };
};

const U = 30; // svg units per short side
const parse = (id: string) => id.split("-").map(Number) as [number, number];

function sidesFor(round: NonNullable<DRoom["round"]>, id: string): Side[] {
  const [x, y] = parse(id);
  if (!round.ends) return round.mustLead && round.mustLead !== id ? [] : ["any"];
  const out: Side[] = [];
  if (x === round.ends.left || y === round.ends.left) out.push("left");
  if (x === round.ends.right || y === round.ends.right) out.push("right");
  return out;
}

export default function DominoRoomPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || "").toUpperCase();
  const { room, seat, error, setError, peerLeft, reactions, emit } = useGameRoom<DRoom>("domino", code);
  const [selected, setSelected] = useState<string | null>(null);
  const [passFlash, setPassFlash] = useState<{ seq: number; mine: boolean } | null>(null);
  const prevHand = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const lastSeq = useRef(0);

  const R = room?.round ?? null;
  const opp: Seat | null = seat === "host" ? "guest" : seat === "guest" ? "host" : null;
  const myTurn = !!R && !R.result && R.turn === seat && !!room?.started;
  const legal = useMemo(() => (R && selected ? sidesFor(R, selected) : []), [R, selected]);

  // hand diff -> flip-in for newly drawn tiles
  useEffect(() => {
    if (!R) return;
    const now = new Set(R.myHand);
    const added = R.myHand.filter((t) => !prevHand.current.has(t));
    const isDeal = prevHand.current.size === 0 || added.length >= 7;
    prevHand.current = now;
    if (added.length && !isDeal) {
      setFresh(new Set(added));
      const t = window.setTimeout(() => setFresh(new Set()), 600);
      return () => window.clearTimeout(t);
    }
  }, [R]);

  // pass indicator
  useEffect(() => {
    const ev = R?.lastEvent;
    if (!ev || ev.seq === lastSeq.current) return;
    lastSeq.current = ev.seq;
    if (ev.type === "pass") {
      setPassFlash({ seq: ev.seq, mine: ev.seat === seat });
      const t = window.setTimeout(() => setPassFlash(null), 1800);
      return () => window.clearTimeout(t);
    }
  }, [R?.lastEvent, seat]);

  useEffect(() => setSelected(null), [R?.chain.length, R?.turn]);

  const layout = useMemo(() => (R ? layoutChain(R.chain, R.anchor) : null), [R]);
  const viewBox = useMemo(() => {
    if (!layout || !layout.tiles.length) return { x: -5 * U, y: -3 * U, w: 10 * U, h: 6 * U };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const pts = [...layout.tiles.map((t) => ({ x: t.x, y: t.y })), layout.left, layout.right];
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    x0 = Math.min(x0 - 1.5, -7.5); x1 = Math.max(x1 + 1.5, 7.5); y0 = Math.min(y0 - 1.5, -3); y1 = Math.max(y1 + 1.5, 3);
    return { x: x0 * U, y: y0 * U, w: (x1 - x0) * U, h: (y1 - y0) * U };
  }, [layout]);

  const latestN = R && R.chain.length ? Math.max(...R.chain.map((c) => c.n)) : -1;

  function play(id: string, side?: Side) {
    if (!R || !myTurn) return;
    const sides = sidesFor(R, id);
    if (!sides.length) {
      setError(R.mustLead && !R.chain.length ? `Ván đầu phải đi quân ${R.mustLead}.` : "Quân này không nối được.");
      return;
    }
    if (!side) {
      const distinct = R.ends && R.ends.left !== R.ends.right;
      if (sides.length === 2 && distinct) { setSelected(id); return; }
      side = sides[0];
    }
    emit("play", { tile: id, side }, (res) => {
      if (!res?.ok) setError(res?.error || "Không đánh được.");
      setSelected(null);
    });
  }

  const status = (() => {
    if (!room || !R) return room?.started ? "" : "Chờ cả hai bấm Ready.";
    if (room.matchWinner) return room.matchWinner === seat ? "🏆 Bạn thắng trận!" : "Đối thủ thắng trận.";
    if (R.result) return "Hết ván.";
    if (R.turn === seat) {
      if (!R.canPlay) return R.boneyard ? "Bạn không có quân nối được — bốc nọc." : "Hết nọc — qua lượt.";
      return R.mustLead && !R.chain.length ? `Tới lượt bạn — mở bàn bằng quân ${R.mustLead}.` : "Tới lượt bạn — chọn quân để đánh.";
    }
    return "Đợi đối thủ…";
  })();

  const res = R?.result;
  const enterVars = (s: string) =>
    ({ ["--fx" as string]: "0px", ["--fy" as string]: `${s === seat ? viewBox.h : -viewBox.h}px`, ["--fr" as string]: s === seat ? "-90deg" : "90deg" }) as React.CSSProperties;

  return (
    <div className="space-y-4">
      <RoomHeader
        prefix="domino" lobbyLabel="Lobby Domino" title="Domino" code={code} room={room} seat={seat}
        peerLeft={peerLeft} emit={emit} over={!!room?.matchWinner} rematchLabel="Chơi trận mới"
      />
      {error && (
        <p onClick={() => setError(null)} className="cursor-pointer rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>
      )}

      {room && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-2 text-sm">
          <span>Ván {room.roundNo || "–"} · chơi tới <b>{room.target}</b></span>
          <span className="font-mono">
            Bạn <b className="text-emerald-300">{seat ? room.matchPoints[seat] : 0}</b> – <b className="text-rose-300">{opp ? room.matchPoints[opp] : 0}</b> Đối thủ
          </span>
          <span>Nọc: <b>{R?.boneyard ?? 14}</b> quân</span>
        </div>
      )}

      {/* opponent hand (backs) */}
      {R && (
        <div className="flex items-center justify-center gap-1">
          <span className={`mr-2 text-xs ${R.turn === opp ? "font-bold text-amber-300" : "text-slate-500"}`}>
            Đối thủ ({R.oppCount}) {R.turn === opp && !R.result ? "• đang đi" : ""}
          </span>
          {Array.from({ length: R.oppCount }, (_, i) => (
            <div key={i} className="h-10 w-5 rounded-[3px] border border-amber-900/70 bg-gradient-to-br from-amber-800 to-amber-950 shadow" />
          ))}
        </div>
      )}

      <p className="text-center text-sm font-medium text-slate-200">{status}</p>

      {/* board */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-900/60 bg-[radial-gradient(ellipse_at_center,#14532d_0%,#0b3b20_70%,#072814_100%)] shadow-inner"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain");
          if (id) play(id);
        }}
      >
        <svg
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="block h-auto max-h-[60vh] w-full transition-all duration-500"
          preserveAspectRatio="xMidYMid meet"
        >
          {layout?.tiles.map((t) => (
            <g
              key={t.n}
              className={t.n === latestN && R?.lastEvent?.type === "play" ? "dm-enter" : ""}
              style={t.n === latestN ? enterVars(t.seat) : undefined}
            >
              <g transform={`translate(${t.x * U} ${t.y * U}) rotate(${t.angle})`}>
                <TileShape a={t.first} b={t.second} u={U} />
              </g>
            </g>
          ))}
          {myTurn && selected && layout && (legal as Side[]).map((s) => {
            const p = s === "left" ? layout.left : s === "right" ? layout.right : { x: 0, y: 0 };
            return (
              <g key={s} className="cursor-pointer" onClick={() => play(selected, s)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); play(e.dataTransfer.getData("text/plain") || selected, s); }}
              >
                <rect className="dm-marker" x={p.x * U - U} y={p.y * U - U / 2} width={2 * U} height={U} rx={U * 0.15}
                  fill="rgba(34,211,238,0.25)" stroke="#22d3ee" strokeWidth={2.5} strokeDasharray="6 4" />
                <text x={p.x * U} y={p.y * U + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#cffafe">
                  {s === "left" ? "Trái" : s === "right" ? "Phải" : "Đặt"}
                </text>
              </g>
            );
          })}
        </svg>
        {passFlash && (
          <div key={passFlash.seq} className="dm-pass pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-2xl bg-slate-950/80 px-6 py-3 text-2xl font-extrabold text-amber-300 shadow-xl">
              {passFlash.mine ? "Bạn qua lượt" : "Đối thủ qua lượt"}
            </span>
          </div>
        )}
        {R?.ends && (
          <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-emerald-200/70">
            Hai đầu: {R.ends.left} · {R.ends.right}
          </p>
        )}
      </div>

      {/* my hand */}
      {R && (
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-sm ${myTurn ? "font-bold text-emerald-300" : "text-slate-400"}`}>
              Bài của bạn ({R.myHand.length}) {myTurn ? "• tới lượt bạn" : ""}
            </p>
            {myTurn && !R.canPlay && (
              <button type="button" onClick={() => emit("draw")}
                className="btn-fx rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400">
                {R.boneyard ? `Bốc nọc (${R.boneyard})` : "Qua lượt"}
              </button>
            )}
            {selected && legal.length === 2 && (
              <span className="text-xs text-cyan-300">Quân này nối được cả hai đầu — chọn ô Trái/Phải trên bàn.</span>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-2" style={{ perspective: 600 }}>
            {R.myHand.map((id) => {
              const [a, b] = parse(id);
              const ok = myTurn && sidesFor(R, id).length > 0;
              return (
                <button
                  key={id}
                  type="button"
                  draggable={ok}
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", id); setSelected(id); }}
                  onClick={() => (selected === id ? setSelected(null) : ok ? play(id) : setSelected(id))}
                  className={`btn-fx rounded-md p-0.5 ${fresh.has(id) ? "dm-flip" : ""} ${ok ? "" : myTurn ? "opacity-40" : ""} ${
                    selected === id ? "-translate-y-2 ring-2 ring-cyan-400" : ""
                  }`}
                  style={{ ["--glow" as string]: ok ? "rgb(52 211 153 / 0.6)" : undefined } as React.CSSProperties}
                  aria-label={`Quân ${id}`}
                >
                  <DominoTile a={a} b={b} size={30} highlight={ok} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {res && (
        <div className="space-y-2 rounded-2xl border border-emerald-700/40 bg-slate-900/80 p-4">
          <p className="text-lg font-semibold text-emerald-200">
            {res.reason === "domino" ? "Domino! " : "Chặn bài! "}
            {res.winner ? (res.winner === seat ? `Bạn thắng ván +${res.points} điểm` : `Đối thủ thắng ván +${res.points} điểm`) : "Hòa ván (bằng chấm), không ai được điểm"}
          </p>
          <p className="text-sm text-slate-300">
            Chấm còn lại — Bạn: <b>{seat ? res.pips[seat] : 0}</b> · Đối thủ: <b>{opp ? res.pips[opp] : 0}</b>
          </p>
          {opp && res.hands[opp].length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs text-slate-400">
              Bài đối thủ:
              {res.hands[opp].map(([a, b], i) => <DominoTile key={i} a={a} b={b} size={18} />)}
            </div>
          )}
          {!room?.matchWinner && (
            <button type="button" onClick={() => emit("next-round")}
              className="btn-fx rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400">
              Ván tiếp theo
            </button>
          )}
        </div>
      )}

      <ReactionBar emit={emit} reactions={reactions} />
    </div>
  );
}
