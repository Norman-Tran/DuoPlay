"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";

type Piece = { color: "w" | "b"; type: string } | null;
type EndReason =
  | "checkmate"
  | "resign"
  | "stalemate"
  | "threefold"
  | "fifty"
  | "insufficient"
  | "agreement"
  | null;
type RoomState = {
  code: string;
  hostSeated: boolean;
  guestSeated: boolean;
  hostReady: boolean;
  guestReady: boolean;
  fen: string;
  board: Piece[][];
  turn: "white" | "black";
  winner: "white" | "black" | "draw" | null;
  endReason?: EndReason;
  drawOfferFrom?: "white" | "black" | null;
  inCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  turnDeadline: number | null;
  turnLimitSec: number;
  lastMove: { from: string; to: string; san: string } | null;
  lastMoveAuto: boolean;
  score: { white: number; black: number };
};

type Reaction = { id: number; emoji: string; seat: "host" | "guest"; color: string };

const REACTIONS = [
  { id: "thumbsup", label: "👍" },
  { id: "laugh", label: "😂" },
  { id: "wow", label: "😮" },
  { id: "fire", label: "🔥" },
  { id: "cry", label: "😢" },
  { id: "party", label: "🎉" },
  { id: "clap", label: "👏" },
  { id: "heart", label: "❤️" },
];

const PIECE_GLYPH: Record<string, string> = {
  wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function emojiOf(id: string) {
  return REACTIONS.find((r) => r.id === id)?.label || id;
}

function sqName(row: number, col: number) {
  // board[0] = rank 8
  return `${FILES[col]}${8 - row}`;
}

function endReasonLabel(
  room: RoomState,
  color: "white" | "black" | null,
): string {
  const reason = room.endReason;
  if (room.winner === "draw") {
    if (reason === "stalemate" || room.isStalemate) return "Hòa — hết nước";
    if (reason === "threefold") return "Hòa — lặp thế 3 lần";
    if (reason === "fifty") return "Hòa — 50 nước";
    if (reason === "insufficient") return "Hòa — thiếu quân";
    if (reason === "agreement") return "Hòa — đồng ý";
    return "Hòa";
  }
  if (room.winner) {
    const iWon = room.winner === color;
    if (reason === "resign") {
      return iWon ? "Thắng — đối thủ đầu hàng" : "Thua — bạn đã đầu hàng";
    }
    if (reason === "checkmate" || room.isCheckmate) {
      return iWon ? "Thắng — chiếu hết" : "Thua — bị chiếu hết";
    }
    const winLabel = room.winner === "white" ? "Trắng" : "Đen";
    return iWon ? `Bạn thắng (${winLabel})` : `Đối thủ thắng (${winLabel})`;
  }
  return "";
}

export default function ChessRoomPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || "").toUpperCase();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [color, setColor] = useState<"white" | "black" | null>(null);
  const [seat, setSeat] = useState<"host" | "guest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peerLeft, setPeerLeft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const reactId = useRef(0);

  const applyJoinOrSync = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;

    const onUpdate = (next: RoomState) => {
      setRoom(next);
      if (next.hostSeated && next.guestSeated) setPeerLeft(false);
      setNow(Date.now());
      setSelected(null);
      setTargets([]);
      setPromo(null);
    };
    const onPeerLeft = () => setPeerLeft(true);
    const onReaction = (payload: { emoji: string; seat: "host" | "guest"; color: string }) => {
      const id = ++reactId.current;
      setReactions((list) => [...list.slice(-8), { id, ...payload }]);
      window.setTimeout(() => setReactions((list) => list.filter((r) => r.id !== id)), 2800);
    };

    socket.on("chess:update", onUpdate);
    socket.on("chess:peer-left", onPeerLeft);
    socket.on("chess:reaction", onReaction);

    socket.emit(
      "chess:state",
      (res: { ok: boolean; seat?: "host" | "guest"; color?: "white" | "black"; room?: RoomState; error?: string }) => {
        if (res?.ok && res.room) {
          setRoom(res.room);
          setSeat(res.seat ?? null);
          setColor(res.color ?? null);
          return;
        }
        socket.emit(
          "chess:join",
          code,
          (joinRes: {
            ok: boolean;
            seat?: "host" | "guest";
            color?: "white" | "black";
            room?: RoomState;
            error?: string;
          }) => {
            if (!joinRes?.ok || !joinRes.room) {
              setError(joinRes?.error || "Không vào được phòng.");
              return;
            }
            setRoom(joinRes.room);
            setSeat(joinRes.seat ?? null);
            setColor(joinRes.color ?? null);
          },
        );
      },
    );

    return () => {
      socket.off("chess:update", onUpdate);
      socket.off("chess:peer-left", onPeerLeft);
      socket.off("chess:reaction", onReaction);
    };
  }, [code]);

  useEffect(() => applyJoinOrSync(), [applyJoinOrSync]);

  useEffect(() => {
    if (!room?.turnDeadline || room.winner) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [room?.turnDeadline, room?.winner, room?.turn]);

  const secondsLeft = useMemo(() => {
    if (!room?.turnDeadline || room.winner) return null;
    return Math.max(0, Math.ceil((room.turnDeadline - now) / 1000));
  }, [room, now]);

  const bothReady = !!(room?.hostReady && room?.guestReady);
  const bothSeated = !!(room?.hostSeated && room?.guestSeated);
  const myReady = seat === "host" ? !!room?.hostReady : seat === "guest" ? !!room?.guestReady : false;
  const myTurn = !!room && !room.winner && bothReady && room.turn === color;
  const playing = !!room && !room.winner && bothReady && bothSeated;
  const iOfferedDraw = !!(room?.drawOfferFrom && color && room.drawOfferFrom === color);
  const opponentOfferedDraw = !!(room?.drawOfferFrom && color && room.drawOfferFrom !== color);

  const statusText = useMemo(() => {
    if (!room) return "Đang kết nối…";
    if (room.winner) return endReasonLabel(room, color);
    if (!bothSeated) return "Chờ đủ 2 người.";
    if (!bothReady) return "Chờ cả hai bấm Ready.";
    if (opponentOfferedDraw) return "Đối thủ xin hòa — chấp nhận hoặc từ chối.";
    if (iOfferedDraw) return "Đã xin hòa — chờ đối thủ.";
    if (room.inCheck) {
      return room.turn === color ? "Bạn đang bị chiếu!" : "Đối thủ đang bị chiếu";
    }
    if (room.turn === color) return "Tới lượt bạn";
    return "Đợi đối thủ…";
  }, [room, color, bothSeated, bothReady, opponentOfferedDraw, iOfferedDraw]);

  const displayBoard = useMemo(() => {
    if (!room?.board) return [];
    if (color === "black") {
      return room.board
        .slice()
        .reverse()
        .map((rank) => rank.slice().reverse());
    }
    return room.board;
  }, [room?.board, color]);

  function displayToTrue(dr: number, dc: number) {
    if (color === "black") return { row: 7 - dr, col: 7 - dc };
    return { row: dr, col: dc };
  }

  async function pickSquare(dr: number, dc: number) {
    if (!room || room.winner || !bothReady || !myTurn) return;
    const { row, col } = displayToTrue(dr, dc);
    const name = sqName(row, col);
    const piece = room.board[row][col];

    if (selected && targets.includes(name)) {
      // need promotion?
      const moving = room.board[
        8 - parseInt(selected[1], 10)
      ]?.[FILES.indexOf(selected[0])];
      const isPawn = moving?.type === "p";
      const toRank = name[1];
      if (isPawn && (toRank === "8" || toRank === "1")) {
        setPromo({ from: selected, to: name });
        return;
      }
      doMove(selected, name);
      return;
    }

    if (piece && ((piece.color === "w" && color === "white") || (piece.color === "b" && color === "black"))) {
      const socket = getSocket();
      socket?.emit("chess:moves", name, (res: { ok: boolean; moves: { to: string }[] }) => {
        setSelected(name);
        setTargets(res?.moves?.map((m) => m.to) || []);
      });
      return;
    }
    setSelected(null);
    setTargets([]);
  }

  function doMove(from: string, to: string, promotion?: string) {
    getSocket()?.emit(
      "chess:move",
      { from, to, promotion },
      (res: { ok: boolean; error?: string; room?: RoomState }) => {
        if (!res?.ok) setError(res?.error || "Không đi được.");
        else if (res.room) setRoom(res.room);
        setSelected(null);
        setTargets([]);
        setPromo(null);
      },
    );
  }

  function toggleReady() {
    getSocket()?.emit("chess:ready", !myReady, (res: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!res?.ok) setError(res?.error || "Không đổi Ready được.");
      else if (res.room) setRoom(res.room);
    });
  }

  function rematch() {
    getSocket()?.emit("chess:rematch", (res: { ok: boolean; room?: RoomState }) => {
      if (res?.ok && res.room) setRoom(res.room);
    });
  }

  function sendReact(id: string) {
    getSocket()?.emit("chess:react", id, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error || "Không gửi được reaction.");
    });
  }

  function resign() {
    if (!playing || actionBusy) return;
    if (!window.confirm("Bạn chắc muốn đầu hàng?")) return;
    setActionBusy(true);
    getSocket()?.emit("chess:resign", (res: { ok: boolean; error?: string; room?: RoomState }) => {
      setActionBusy(false);
      if (!res?.ok) setError(res?.error || "Không đầu hàng được.");
      else if (res.room) setRoom(res.room);
    });
  }

  function offerOrCancelDraw() {
    if (!playing || actionBusy) return;
    setActionBusy(true);
    getSocket()?.emit(
      "chess:draw-offer",
      (res: { ok: boolean; error?: string; room?: RoomState; cancelled?: boolean }) => {
        setActionBusy(false);
        if (!res?.ok) setError(res?.error || "Không xin hòa được.");
        else if (res.room) setRoom(res.room);
      },
    );
  }

  function acceptDraw() {
    if (!playing || actionBusy) return;
    setActionBusy(true);
    getSocket()?.emit("chess:draw-accept", (res: { ok: boolean; error?: string; room?: RoomState }) => {
      setActionBusy(false);
      if (!res?.ok) setError(res?.error || "Không chấp nhận hòa được.");
      else if (res.room) setRoom(res.room);
    });
  }

  function declineDraw() {
    if (!playing || actionBusy) return;
    setActionBusy(true);
    getSocket()?.emit("chess:draw-decline", (res: { ok: boolean; error?: string; room?: RoomState }) => {
      setActionBusy(false);
      if (!res?.ok) setError(res?.error || "Không từ chối được.");
      else if (res.room) setRoom(res.room);
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

  const limit = room?.turnLimitSec ?? 60;
  const urgent = secondsLeft !== null && secondsLeft <= 10;
  const pct =
    secondsLeft === null || !room?.turnDeadline
      ? 0
      : Math.max(0, Math.min(100, ((room.turnDeadline - now) / (limit * 1000)) * 100));

  return (
    <div className="relative space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/game/chess" className="text-sm text-cyan-400 hover:underline">
            ← Lobby Cờ vua
          </Link>
          <h1 className="text-xl font-bold">
            Phòng <span className="font-mono tracking-widest text-cyan-300">{code}</span>
          </h1>
          <p className="text-sm text-slate-400">
            Bạn là {seat === "host" ? "Host (Trắng)" : seat === "guest" ? "Guest (Đen)" : "…"} · {statusText}
          </p>
        </div>
        <button
          type="button"
          onClick={copyCode}
          className="rounded-xl border border-slate-700 px-3 py-2 text-sm hover:border-cyan-500"
        >
          {copied ? "Đã copy!" : "Copy mã phòng"}
        </button>
      </div>

      {room && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-700/40 bg-slate-900/70 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Bảng điểm phiên</p>
            <p className="mt-1 text-xs text-slate-400">Giữ khi rematch; rời phòng → reset.</p>
          </div>
          <div className="flex items-center gap-4 font-mono text-lg font-bold">
            <span className="rounded-xl border border-slate-500/50 bg-slate-100 px-3 py-1.5 text-slate-900">
              Trắng {room.score?.white ?? 0}
            </span>
            <span className="text-slate-600">:</span>
            <span className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-1.5 text-slate-100">
              Đen {room.score?.black ?? 0}
            </span>
          </div>
        </div>
      )}

      {peerLeft && (
        <div className="rounded-2xl border-2 border-amber-400/70 bg-amber-950/50 px-4 py-3">
          <p className="text-base font-semibold text-amber-100">Đối thủ đã rời phòng / mất kết nối</p>
          <p className="mt-1 text-sm text-amber-200/90">
            Timer tạm dừng, điểm phiên đã reset. Chờ họ vào lại bằng mã{" "}
            <span className="font-mono font-bold">{code}</span>.
          </p>
        </div>
      )}

      {bothSeated && !room?.winner && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3">
          <div className="flex-1 text-sm text-slate-300">
            Ready: Host {room?.hostReady ? "✅" : "⏳"} · Guest {room?.guestReady ? "✅" : "⏳"}
          </div>
          <button
            type="button"
            onClick={toggleReady}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              myReady
                ? "border border-emerald-500 bg-emerald-950 text-emerald-200"
                : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            }`}
          >
            {myReady ? "Huỷ Ready" : "Ready"}
          </button>
        </div>
      )}

      {playing && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3">
          <button
            type="button"
            disabled={actionBusy}
            onClick={resign}
            className="rounded-xl border border-rose-500/60 bg-rose-950/50 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-900/60 disabled:opacity-50"
          >
            Đầu hàng
          </button>
          {!opponentOfferedDraw && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={offerOrCancelDraw}
              className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                iOfferedDraw
                  ? "border border-amber-500/60 bg-amber-950/40 text-amber-100 hover:bg-amber-900/50"
                  : "border border-sky-500/50 bg-sky-950/40 text-sky-100 hover:bg-sky-900/50"
              }`}
            >
              {iOfferedDraw ? "Huỷ xin hòa" : "Xin hòa"}
            </button>
          )}
          {opponentOfferedDraw && (
            <>
              <span className="text-sm text-amber-200">Đối thủ xin hòa</span>
              <button
                type="button"
                disabled={actionBusy}
                onClick={acceptDraw}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Chấp nhận hòa
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={declineDraw}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-400 disabled:opacity-50"
              >
                Từ chối
              </button>
            </>
          )}
        </div>
      )}

      {room && !room.winner && bothReady && secondsLeft !== null && (
        <div
          className={`rounded-2xl border px-4 py-3 ${
            urgent ? "border-rose-500/60 bg-rose-950/40" : "border-slate-700 bg-slate-900/70"
          }`}
        >
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">
              Lượt <strong>{room.turn === "white" ? "Trắng" : "Đen"}</strong>
              {room.turn === color ? " (bạn)" : " (đối thủ)"} · mỗi lượt {limit}s
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
          Nước vừa rồi là <strong>tự động</strong> (hết {limit}s): {room.lastMove?.san}
        </p>
      )}

      {room?.lastMove && !room.lastMoveAuto && (
        <p className="text-xs text-slate-500">Nước gần nhất: {room.lastMove.san}</p>
      )}

      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>
      )}

      <div className="relative mx-auto w-max rounded-2xl border border-slate-800 bg-slate-900/60 p-2 sm:p-3">
        <div className="grid grid-cols-8 gap-0 overflow-hidden rounded-lg shadow-lg">
          {displayBoard.map((rank, dr) =>
            rank.map((piece, dc) => {
              const { row, col } = displayToTrue(dr, dc);
              const name = sqName(row, col);
              const light = (row + col) % 2 === 0;
              const isSel = selected === name;
              const isTgt = targets.includes(name);
              const isLast =
                room?.lastMove && (room.lastMove.from === name || room.lastMove.to === name);
              const glyph = piece ? PIECE_GLYPH[`${piece.color}${piece.type}`] : "";
              return (
                <button
                  key={name}
                  type="button"
                  disabled={!bothReady || !!room?.winner || !myTurn}
                  onClick={() => pickSquare(dr, dc)}
                  className={`relative flex h-10 w-10 items-center justify-center text-2xl sm:h-12 sm:w-12 sm:text-3xl ${
                    light ? "bg-amber-100 text-slate-900" : "bg-amber-800 text-slate-50"
                  } ${isSel ? "ring-2 ring-inset ring-cyan-400" : ""} ${
                    isLast ? "outline outline-2 outline-yellow-300/80 -outline-offset-2" : ""
                  }`}
                >
                  {glyph}
                  {isTgt && (
                    <span
                      className={`absolute rounded-full ${
                        piece ? "inset-1 border-2 border-emerald-400/80" : "h-3 w-3 bg-emerald-500/70"
                      }`}
                    />
                  )}
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
              style={{ left: r.seat === "host" ? "10%" : "80%", top: "35%" }}
            >
              {emojiOf(r.emoji)}
            </div>
          ))}
        </div>
      </div>

      {promo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <p className="mb-3 text-sm font-medium text-slate-200">Chọn quân phong cấp</p>
            <div className="flex gap-2">
              {(
                [
                  ["q", "Hậu"],
                  ["r", "Xe"],
                  ["b", "Tượng"],
                  ["n", "Mã"],
                ] as const
              ).map(([p, label]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => doMove(promo.from, promo.to, p)}
                  className="rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPromo(null)}
                className="rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-300"
              >
                Huỷ
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 px-3 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Reaction nhanh</p>
        <div className="flex flex-wrap gap-2">
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => sendReact(r.id)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xl hover:border-cyan-500"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {room?.winner && (
        <div className="space-y-2 rounded-2xl border border-emerald-700/40 bg-slate-900/70 p-4">
          <p className="font-semibold text-emerald-200">{endReasonLabel(room, color)}</p>
          <button
            type="button"
            onClick={rematch}
            className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Chơi lại
          </button>
          <p className="text-xs text-slate-500">Sau rematch cả hai phải Ready lại.</p>
        </div>
      )}
    </div>
  );
}