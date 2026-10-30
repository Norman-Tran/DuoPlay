"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";

type Cell = "X" | "O" | null;
type RoomState = {
  code: string;
  size: number;
  hostSeated: boolean;
  guestSeated: boolean;
  hostReady: boolean;
  guestReady: boolean;
  board: Cell[][];
  turn: "X" | "O";
  winner: "X" | "O" | "draw" | null;
  turnDeadline: number | null;
  turnLimitSec: number;
  lastMoveAuto: boolean;
  winningLine: { row: number; col: number }[] | null;
  allowedSizes: number[];
  score: { X: number; O: number };
};

type Reaction = {
  id: number;
  emoji: string;
  seat: "host" | "guest";
  mark: "X" | "O";
  at: number;
};

const REACTIONS: { id: string; label: string }[] = [
  { id: "thumbsup", label: "👍" },
  { id: "laugh", label: "😂" },
  { id: "wow", label: "😮" },
  { id: "fire", label: "🔥" },
  { id: "cry", label: "😢" },
  { id: "party", label: "🎉" },
  { id: "clap", label: "👏" },
  { id: "heart", label: "❤️" },
];

const SIZES = [15, 30, 45];

function emojiOf(id: string) {
  return REACTIONS.find((r) => r.id === id)?.label || id;
}

function cellPx(size: number) {
  if (size >= 45) return "1.05rem";
  if (size >= 30) return "1.25rem";
  return "1.6rem";
}

export default function CaroRoomPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || "").toUpperCase();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [mark, setMark] = useState<"X" | "O" | null>(null);
  const [seat, setSeat] = useState<"host" | "guest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peerLeft, setPeerLeft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [showCelebrate, setShowCelebrate] = useState(false);
  const [rematchSize, setRematchSize] = useState(15);
  const reactId = useRef(0);
  const prevWinner = useRef<"X" | "O" | "draw" | null>(null);

  const applyJoinOrSync = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;

    const onUpdate = (next: RoomState) => {
      setRoom(next);
      if (next.hostSeated && next.guestSeated) setPeerLeft(false);
      setNow(Date.now());
      if (next.size) setRematchSize(next.size);
    };
    const onPeerLeft = () => setPeerLeft(true);
    const onReaction = (payload: { emoji: string; seat: "host" | "guest"; mark: "X" | "O"; at: number }) => {
      const id = ++reactId.current;
      setReactions((list) => [...list.slice(-8), { id, ...payload }]);
      window.setTimeout(() => {
        setReactions((list) => list.filter((r) => r.id !== id));
      }, 2800);
    };

    socket.on("room:update", onUpdate);
    socket.on("room:peer-left", onPeerLeft);
    socket.on("caro:reaction", onReaction);

    socket.emit(
      "room:state",
      (res: {
        ok: boolean;
        seat?: "host" | "guest";
        mark?: "X" | "O";
        room?: RoomState;
        error?: string;
      }) => {
        if (res?.ok && res.room) {
          setRoom(res.room);
          setSeat(res.seat ?? null);
          setMark(res.mark ?? null);
          if (res.room.size) setRematchSize(res.room.size);
          return;
        }
        socket.emit(
          "room:join",
          code,
          (joinRes: {
            ok: boolean;
            seat?: "host" | "guest";
            mark?: "X" | "O";
            room?: RoomState;
            error?: string;
          }) => {
            if (!joinRes?.ok || !joinRes.room) {
              setError(joinRes?.error || "Không vào được phòng.");
              return;
            }
            setRoom(joinRes.room);
            setSeat(joinRes.seat ?? null);
            setMark(joinRes.mark ?? null);
            if (joinRes.room.size) setRematchSize(joinRes.room.size);
          },
        );
      },
    );

    return () => {
      socket.off("room:update", onUpdate);
      socket.off("room:peer-left", onPeerLeft);
      socket.off("caro:reaction", onReaction);
    };
  }, [code]);

  useEffect(() => applyJoinOrSync(), [applyJoinOrSync]);

  useEffect(() => {
    if (!room?.turnDeadline || room.winner) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [room?.turnDeadline, room?.winner, room?.turn]);

  useEffect(() => {
    if (!room) return;
    if (room.winner && room.winner !== "draw" && prevWinner.current !== room.winner) {
      setShowCelebrate(true);
      const t = window.setTimeout(() => setShowCelebrate(false), 4200);
      prevWinner.current = room.winner;
      return () => window.clearTimeout(t);
    }
    if (!room.winner) prevWinner.current = null;
  }, [room?.winner]);

  const secondsLeft = useMemo(() => {
    if (!room?.turnDeadline || room.winner) return null;
    return Math.max(0, Math.ceil((room.turnDeadline - now) / 1000));
  }, [room, now]);

  const winSet = useMemo(() => {
    const set = new Set<string>();
    for (const cell of room?.winningLine || []) set.add(`${cell.row},${cell.col}`);
    return set;
  }, [room?.winningLine]);

  const bothReady = !!(room?.hostReady && room?.guestReady);
  const bothSeated = !!(room?.hostSeated && room?.guestSeated);
  const myReady = seat === "host" ? !!room?.hostReady : seat === "guest" ? !!room?.guestReady : false;

  const statusText = useMemo(() => {
    if (!room) return "Đang kết nối…";
    if (room.winner === "draw") return "Hoà!";
    if (room.winner) return room.winner === mark ? "Bạn thắng" : `Đối thủ (${room.winner}) thắng`;
    if (!bothSeated) return "Chờ đủ 2 người…";
    if (!bothReady) return "Chờ cả hai bấm Ready…";
    if (room.turn === mark) return "Tới lượt bạn";
    return "Đợi đối thủ…";
  }, [room, mark, bothSeated, bothReady]);

  function place(row: number, col: number) {
    if (!room || room.winner || room.board[row][col]) return;
    if (!bothReady) return;
    if (room.turn !== mark) return;
    const socket = getSocket();
    socket?.emit("caro:move", { row, col }, (res: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!res?.ok) setError(res?.error || "Không đánh được.");
      else if (res.room) setRoom(res.room);
    });
  }

  function toggleReady() {
    getSocket()?.emit("room:ready", !myReady, (res: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!res?.ok) setError(res?.error || "Không đổi Ready được.");
      else if (res.room) setRoom(res.room);
    });
  }

  function rematch() {
    const payload = seat === "host" ? { size: rematchSize } : {};
    getSocket()?.emit("caro:rematch", payload, (res: { ok: boolean; room?: RoomState }) => {
      if (res?.ok && res.room) {
        setRoom(res.room);
        setShowCelebrate(false);
        prevWinner.current = null;
        setRematchSize(res.room.size);
      }
    });
  }

  function sendReact(id: string) {
    getSocket()?.emit("caro:react", id, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error || "Không gửi được reaction.");
    });
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Không copy được mã.");
    }
  }

  const limit = room?.turnLimitSec ?? 45;
  const urgent = secondsLeft !== null && secondsLeft <= 10;
  const pct =
    secondsLeft === null || !room?.turnDeadline
      ? 0
      : Math.max(0, Math.min(100, ((room.turnDeadline - now) / (limit * 1000)) * 100));
  const iWon = !!room?.winner && room.winner !== "draw" && room.winner === mark;
  const size = room?.size || 15;
  const px = cellPx(size);

  return (
    <div className="relative space-y-4">
      {showCelebrate && iWon && (
        <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          <div className="absolute inset-0 bg-emerald-500/10 animate-pulse" />
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="absolute text-2xl animate-bounce"
              style={{
                left: `${(i * 37) % 100}%`,
                top: `${(i * 53) % 80}%`,
                animationDelay: `${(i % 8) * 0.12}s`,
                opacity: 0.85,
              }}
            >
              {["🎉", "✨", "🏆", "🎊"][i % 4]}
            </span>
          ))}
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-2xl border border-emerald-400/50 bg-slate-950/90 px-6 py-4 text-center shadow-2xl">
            <p className="text-3xl font-black text-emerald-300">Chiến thắng!</p>
            <p className="text-sm text-slate-300">Bạn đã thắng ván Caro này</p>
          </div>
        </div>
      )}

      {showCelebrate && room?.winner && room.winner !== "draw" && room.winner !== mark && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-start justify-center pt-24">
          <div className="rounded-2xl border border-slate-600 bg-slate-950/90 px-6 py-4 text-center shadow-2xl">
            <p className="text-2xl font-bold text-slate-200">Đối thủ thắng</p>
            <p className="text-sm text-slate-400">Ván sau sẽ may mắn hơn</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            Phòng <span className="select-text font-mono tracking-widest text-cyan-300">{code}</span>
            <span className="ml-2 text-sm font-normal text-slate-400">
              {size}×{size}
            </span>
          </h1>
          <p className="text-sm text-slate-400">
            Bạn là {seat === "host" ? "Host (X)" : seat === "guest" ? "Guest (O)" : "…"} · {statusText}
          </p>
        </div>
        <button
          type="button"
          onClick={copyCode}
          className="btn-fx rounded-xl border border-slate-700 px-3 py-2 text-sm hover:border-cyan-500"
        >
          {copied ? "Đã copy!" : "Copy mã phòng"}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-300">
        <p className="font-medium text-cyan-200">Luật thắng — chặn 2 đầu</p>
        <p className="mt-1 text-xs text-slate-400">
          5 quân (trở lên) liên tiếp thắng <strong className="text-slate-200">chỉ khi không bị chặn cả 2 đầu</strong>.
          Mỗi đầu: ô trống = mở; quân địch hoặc mép bàn = chặn. Chặn cả 2 đầu → chưa thắng.
        </p>
      </div>

      {room && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-700/40 bg-slate-900/70 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Bảng điểm phiên</p>
            <p className="mt-1 text-sm text-slate-300">
              Chỉ đếm thắng khi cả hai còn trong phòng / rematch. Rời phòng → reset.
            </p>
          </div>
          <div className="flex items-center gap-4 font-mono text-lg font-bold">
            <span className="rounded-xl border border-cyan-600/50 bg-cyan-950/50 px-3 py-1.5 text-cyan-200">
              X (Host) {room.score?.X ?? 0}
            </span>
            <span className="text-slate-600">:</span>
            <span className="rounded-xl border border-fuchsia-600/50 bg-fuchsia-950/50 px-3 py-1.5 text-fuchsia-200">
              O (Guest) {room.score?.O ?? 0}
            </span>
          </div>
        </div>
      )}

      {peerLeft && (
        <div className="rounded-2xl border-2 border-amber-400/70 bg-amber-950/50 px-4 py-3 shadow-lg shadow-amber-900/30">
          <p className="text-base font-semibold text-amber-100">Đối thủ da roi phong / mat ket noi</p>
          <p className="mt-1 text-sm text-amber-200/90">
            Ván đang dừng. Timer đã tạm dừng. Bạn có thể chờ họ vào lại bằng cùng mã phòng{" "}
            <span className="font-mono font-bold">{code}</span>.
          </p>
        </div>
      )}

      {bothSeated && !room?.winner && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3">
          <div className="flex-1 text-sm text-slate-300">
            Ready: Host {room?.hostReady ? "✅" : "⏳"} · Guest {room?.guestReady ? "✅" : "⏳"}
            {!bothReady && <span className="ml-2 text-slate-500">— timer/nước đi khoá đến khi cả hai Ready</span>}
          </div>
          <button
            type="button"
            onClick={toggleReady}
            className={`btn-fx rounded-xl px-4 py-2 text-sm font-semibold ${
              myReady
                ? "border border-emerald-500 bg-emerald-950 text-emerald-200"
                : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            }`}
          >
            {myReady ? "Huỷ Ready" : "Ready"}
          </button>
        </div>
      )}

      {room && !room.winner && bothReady && secondsLeft !== null && (
        <div
          className={`rounded-2xl border px-4 py-3 ${
            urgent ? "border-rose-500/60 bg-rose-950/40" : "border-slate-700 bg-slate-900/70"
          }`}
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">
              Lượt <strong className="text-white">{room.turn}</strong>
              {room.turn === mark ? " (bạn)" : " (đối thủ)"} · mỗi lượt {limit}s
            </span>
            <span className={`font-mono text-2xl font-bold tabular-nums ${urgent ? "text-rose-300" : "text-cyan-300"}`}>
              {secondsLeft}s
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-[width] duration-200 ease-linear ${urgent ? "bg-rose-400" : "bg-cyan-400"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {room?.lastMoveAuto && !room.winner && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
          Nước vừa rồi là <strong>tự động</strong> (hết 45s).
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>
      )}

      <div className="relative overflow-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-2 sm:p-4">
        <div
          className="mx-auto grid w-max gap-px"
          style={{ gridTemplateColumns: `repeat(${size}, minmax(0, ${px}))` }}
        >
          {(room?.board || []).map((row, r) =>
            row.map((cell, c) => {
              const canClick = !!room && !room.winner && bothReady && room.turn === mark && !cell;
              const isWin = winSet.has(`${r},${c}`);
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  disabled={!canClick}
                  onClick={() => place(r, c)}
                  className={`flex items-center justify-center rounded-sm border text-[10px] font-bold ${
                    isWin
                      ? "border-yellow-300 bg-yellow-400 text-slate-950 ring-2 ring-yellow-200 animate-pulse"
                      : cell === "X"
                        ? "border-cyan-600 bg-cyan-950 text-cyan-300"
                        : cell === "O"
                          ? "border-fuchsia-600 bg-fuchsia-950 text-fuchsia-300"
                          : "border-slate-800 bg-slate-950 text-transparent hover:border-slate-600 disabled:hover:border-slate-800"
                  }`}
                  style={{ width: px, height: px }}
                >
                  {cell || "·"}
                </button>
              );
            }),
          )}
        </div>

        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {reactions.map((r) => (
            <div
              key={r.id}
              className="absolute animate-bounce text-3xl"
              style={{
                left: r.seat === "host" ? "12%" : "78%",
                top: "40%",
                animationDuration: "1.2s",
              }}
            >
              {emojiOf(r.emoji)}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 px-3 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Reaction nhanh</p>
        <div className="flex flex-wrap gap-2">
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => sendReact(r.id)}
              className="btn-fx rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xl hover:border-cyan-500 hover:bg-slate-900"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {room?.winner && (
        <div className="space-y-3 rounded-2xl border border-emerald-700/40 bg-slate-900/70 p-4">
          {seat === "host" && (
            <div>
              <p className="mb-2 text-sm text-slate-300">Host chọn kích thước ván mới</p>
              <div className="flex flex-wrap gap-2">
                {(room.allowedSizes || SIZES).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setRematchSize(s)}
                    className={`btn-fx rounded-xl px-3 py-1.5 text-sm font-semibold border ${
                      rematchSize === s
                        ? "border-cyan-400 bg-cyan-500 text-slate-950"
                        : "border-slate-700 text-slate-300"
                    }`}
                  >
                    {s}×{s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {seat === "guest" && (
            <p className="text-sm text-slate-400">
              Bạn sẽ chơi lại trên bàn {room.size}×{room.size} (Host có thể đổi size).
            </p>
          )}
          <button
            type="button"
            onClick={rematch}
            className="btn-fx rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Chơi lại {seat === "host" ? `${rematchSize}×${rematchSize}` : ""}
          </button>
          <p className="text-xs text-slate-500">Sau rematch cả hai phải Ready lại mới bắt đầu.</p>
        </div>
      )}
    </div>
  );
}