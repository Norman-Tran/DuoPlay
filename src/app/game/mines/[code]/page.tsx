"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { getSocket } from "@/lib/socket";

type CellView =
  | { s: "hidden" }
  | { s: "flag" }
  | { s: "open"; n: number }
  | { s: "mine" }
  | { s: "mine-hidden" }
  | { s: "flag-mine" };

type Progress = {
  opened: number;
  flagged: number;
  hitMine: boolean;
  cleared: boolean;
};

type DiffInfo = { id: string; label: string; rows: number; cols: number; mines: number };

type RoomState = {
  code: string;
  hostSeated: boolean;
  guestSeated: boolean;
  hostReady: boolean;
  guestReady: boolean;
  difficulty: string;
  rows: number;
  cols: number;
  mineCount: number;
  safeTotal: number;
  phase: "lobby" | "countdown" | "playing" | "finished";
  countdownEndsAt: number | null;
  startedAt: number | null;
  winner: "host" | "guest" | "draw" | null;
  endReason: string | null;
  score: { host: number; guest: number };
  difficulties: DiffInfo[];
  mySeat: "host" | "guest" | null;
  board: CellView[][] | null;
  me: Progress | null;
  opponent: Progress | null;
  hostProgress: Progress;
  guestProgress: Progress;
  elapsedMs: number;
};

type Reaction = { id: number; emoji: string; seat: "host" | "guest" };

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

const NUM_COLORS = [
  "",
  "text-sky-400",
  "text-emerald-400",
  "text-rose-400",
  "text-violet-400",
  "text-amber-400",
  "text-cyan-300",
  "text-fuchsia-300",
  "text-slate-200",
];

function emojiOf(id: string) {
  return REACTIONS.find((r) => r.id === id)?.label || id;
}

function formatMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function endLabel(room: RoomState, seat: "host" | "guest" | null) {
  if (!room.winner) return "";
  if (room.winner === "draw") {
    if (room.endReason === "both-mine") return "Hòa — cả hai dính bom";
    return "Hòa — cùng lúc";
  }
  const iWon = seat && room.winner === seat;
  if (room.endReason === "mine") {
    return iWon ? "Thắng — đối thủ dính bom" : "Thua — bạn dính bom";
  }
  if (room.endReason === "clear") {
    return iWon ? "Thắng — phá mìn nhanh hơn!" : "Thua — đối thủ phá xong trước";
  }
  return iWon ? "Bạn thắng" : "Đối thủ thắng";
}

export default function MinesRoomPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || "").toUpperCase();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [seat, setSeat] = useState<"host" | "guest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peerLeft, setPeerLeft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [flagMode, setFlagMode] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const reactId = useRef(0);

  const applyJoinOrSync = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;

    const onUpdate = (next: RoomState) => {
      setRoom(next);
      if (next.mySeat) setSeat(next.mySeat);
      if (next.hostSeated && next.guestSeated) setPeerLeft(false);
      setNow(Date.now());
    };
    const onPeerLeft = () => setPeerLeft(true);
    const onReaction = (payload: { emoji: string; seat: "host" | "guest" }) => {
      const id = ++reactId.current;
      setReactions((list) => [...list.slice(-8), { id, ...payload }]);
      window.setTimeout(() => setReactions((list) => list.filter((r) => r.id !== id)), 2800);
    };

    socket.on("mines:update", onUpdate);
    socket.on("mines:peer-left", onPeerLeft);
    socket.on("mines:reaction", onReaction);

    socket.emit(
      "mines:state",
      (res: { ok: boolean; seat?: "host" | "guest"; room?: RoomState; error?: string }) => {
        if (res?.ok && res.room) {
          setRoom(res.room);
          setSeat(res.seat ?? res.room.mySeat ?? null);
          return;
        }
        socket.emit(
          "mines:join",
          code,
          (joinRes: { ok: boolean; seat?: "host" | "guest"; room?: RoomState; error?: string }) => {
            if (!joinRes?.ok || !joinRes.room) {
              setError(joinRes?.error || "Không vào được phòng.");
              return;
            }
            setRoom(joinRes.room);
            setSeat(joinRes.seat ?? joinRes.room.mySeat ?? null);
          },
        );
      },
    );

    return () => {
      socket.off("mines:update", onUpdate);
      socket.off("mines:peer-left", onPeerLeft);
      socket.off("mines:reaction", onReaction);
    };
  }, [code]);

  useEffect(() => applyJoinOrSync(), [applyJoinOrSync]);

  useEffect(() => {
    if (!room) return;
    if (room.phase !== "countdown" && room.phase !== "playing") return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [room?.phase, room?.countdownEndsAt, room?.startedAt]);

  const countdownLeft = useMemo(() => {
    if (!room?.countdownEndsAt || room.phase !== "countdown") return null;
    return Math.max(0, Math.ceil((room.countdownEndsAt - now) / 1000));
  }, [room, now]);

  const elapsed = useMemo(() => {
    if (!room?.startedAt) return 0;
    if (room.phase === "finished") return room.elapsedMs;
    return Math.max(0, now - room.startedAt);
  }, [room, now]);

  const bothReady = !!(room?.hostReady && room?.guestReady);
  const bothSeated = !!(room?.hostSeated && room?.guestSeated);
  const myReady = seat === "host" ? !!room?.hostReady : seat === "guest" ? !!room?.guestReady : false;
  const playing = room?.phase === "playing";
  const canPlay = playing && !room?.me?.hitMine && !room?.me?.cleared && !room?.winner;

  const statusText = useMemo(() => {
    if (!room) return "Đang kết nối…";
    if (room.phase === "finished") return endLabel(room, seat);
    if (!bothSeated) return "Chờ đủ 2 người.";
    if (room.phase === "countdown") return `Sẵn sàng… ${countdownLeft ?? 3}`;
    if (room.phase === "playing") {
      if (room.me?.hitMine) return "Bạn dính bom — chờ kết quả…";
      if (room.me?.cleared) return "Bạn đã phá xong!";
      return flagMode ? "Chế độ cắm cờ" : "Mở ô — đua với đối thủ!";
    }
    if (!bothReady) return "Chờ cả hai bấm Ready.";
    return "Chờ bắt đầu…";
  }, [room, seat, bothSeated, bothReady, countdownLeft, flagMode]);

  function toggleReady() {
    getSocket()?.emit("mines:ready", !myReady, (res: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!res?.ok) setError(res?.error || "Không đổi Ready được.");
      else if (res.room) setRoom(res.room);
    });
  }

  function setDiff(id: string) {
    getSocket()?.emit("mines:set-diff", id, (res: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!res?.ok) setError(res?.error || "Không đổi độ khó.");
      else if (res.room) setRoom(res.room);
    });
  }

  function rematch() {
    getSocket()?.emit("mines:rematch", (res: { ok: boolean; room?: RoomState }) => {
      if (res?.ok && res.room) {
        setRoom(res.room);
        setFlagMode(false);
      }
    });
  }

  function openCell(r: number, c: number) {
    if (!canPlay) return;
    getSocket()?.emit("mines:open", { row: r, col: c }, (res: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!res?.ok) setError(res?.error || "Không mở được.");
      else if (res.room) setRoom(res.room);
    });
  }

  function flagCell(r: number, c: number) {
    if (!canPlay) return;
    getSocket()?.emit("mines:flag", { row: r, col: c }, (res: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!res?.ok) setError(res?.error || "Không cắm cờ được.");
      else if (res.room) setRoom(res.room);
    });
  }

  function onCellClick(r: number, c: number) {
    if (flagMode) flagCell(r, c);
    else openCell(r, c);
  }

  function onContextMenu(e: MouseEvent, r: number, c: number) {
    e.preventDefault();
    flagCell(r, c);
  }

  function sendReact(id: string) {
    getSocket()?.emit("mines:react", id, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error || "Không gửi reaction.");
    });
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Không copy được mã.");
    }
  }

  const cellSize =
    room && room.cols >= 16 ? "h-6 w-6 text-[10px] sm:h-7 sm:w-7 sm:text-xs" :
    room && room.cols >= 12 ? "h-7 w-7 text-xs sm:h-8 sm:w-8 sm:text-sm" :
    "h-8 w-8 text-sm sm:h-9 sm:w-9 sm:text-base";

  const myOpened = room?.me?.opened ?? 0;
  const safeTotal = room?.safeTotal ?? 1;
  const oppOpened = room?.opponent?.opened ?? 0;
  const myPct = Math.min(100, Math.round((myOpened / safeTotal) * 100));
  const oppPct = Math.min(100, Math.round((oppOpened / safeTotal) * 100));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mt-1 text-xl font-bold sm:text-2xl">Dò mìn đua tốc độ</h1>
          <p className="mt-1 text-sm text-slate-400">
            Mã phòng{" "}
            <button
              type="button"
              onClick={copyCode}
              className="select-text font-mono font-bold tracking-widest text-cyan-300 hover:underline"
            >
              {code}
            </button>
            {copied ? " · đã copy" : " · bấm để copy"}
            {seat ? ` · bạn là ${seat === "host" ? "Host" : "Guest"}` : ""}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm">
          <p className="font-medium text-slate-200">{statusText}</p>
          {room && (
            <p className="mt-0.5 text-xs text-slate-500">
              {room.rows}×{room.cols} · {room.mineCount} mìn · {room.difficulty}
            </p>
          )}
        </div>
      </div>

      {room && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="rounded-xl border border-cyan-600/50 bg-cyan-950/40 px-3 py-1.5 text-cyan-200">
              Host {room.score?.host ?? 0}
            </span>
            <span className="text-slate-600">:</span>
            <span className="rounded-xl border border-fuchsia-600/50 bg-fuchsia-950/40 px-3 py-1.5 text-fuchsia-200">
              Guest {room.score?.guest ?? 0}
            </span>
          </div>
          {(playing || room.phase === "finished") && (
            <span className="ml-auto font-mono text-lg font-bold tabular-nums text-cyan-300">
              {formatMs(elapsed)}
            </span>
          )}
        </div>
      )}

      {peerLeft && (
        <div className="rounded-2xl border-2 border-amber-400/70 bg-amber-950/50 px-4 py-3">
          <p className="text-base font-semibold text-amber-100">Đối thủ đã rời phòng / mất kết nối</p>
          <p className="mt-1 text-sm text-amber-200/90">
            Điểm phiên đã reset. Chờ họ vào lại bằng mã{" "}
            <span className="font-mono font-bold">{code}</span>.
          </p>
        </div>
      )}

      {room && seat === "host" && room.phase === "lobby" && !room.winner && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <p className="mb-2 text-sm font-medium text-slate-300">Độ khó (Host)</p>
          <div className="flex flex-wrap gap-2">
            {(room.difficulties || []).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDiff(d.id)}
                className={`btn-fx rounded-xl border px-3 py-1.5 text-sm font-semibold ${
                  room.difficulty === d.id
                    ? "border-cyan-400 bg-cyan-500 text-slate-950"
                    : "border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-600"
                }`}
              >
                {d.label} ({d.rows}×{d.cols}, {d.mines})
              </button>
            ))}
          </div>
        </div>
      )}

      {bothSeated && room?.phase === "lobby" && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3">
          <div className="flex-1 text-sm text-slate-300">
            Ready: Host {room?.hostReady ? "✅" : "⬜"} · Guest {room?.guestReady ? "✅" : "⬜"}
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

      {room?.phase === "countdown" && (
        <div className="rounded-2xl border border-cyan-500/50 bg-cyan-950/40 px-4 py-6 text-center">
          <p className="text-sm uppercase tracking-widest text-cyan-300/80">Bắt đầu sau</p>
          <p className="mt-1 font-mono text-5xl font-bold text-cyan-200">{countdownLeft ?? 3}</p>
        </div>
      )}

      {(playing || room?.phase === "finished") && room && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-cyan-700/40 bg-slate-900/70 px-3 py-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Bạn {seat === "host" ? "(Host)" : "(Guest)"}</span>
              <span>
                {myOpened}/{safeTotal}
                {room.me?.hitMine ? " 💥" : ""}
                {room.me?.cleared ? " ✅" : ""}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full bg-cyan-400 transition-[width]" style={{ width: `${myPct}%` }} />
            </div>
          </div>
          <div className="rounded-2xl border border-fuchsia-700/40 bg-slate-900/70 px-3 py-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Đối thủ</span>
              <span>
                {oppOpened}/{safeTotal}
                {room.opponent?.hitMine ? " 💥" : ""}
                {room.opponent?.cleared ? " ✅" : ""}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full bg-fuchsia-400 transition-[width]" style={{ width: `${oppPct}%` }} />
            </div>
          </div>
        </div>
      )}

      {playing && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFlagMode(false)}
            className={`btn-fx rounded-xl px-4 py-2 text-sm font-semibold ${
              !flagMode
                ? "bg-cyan-500 text-slate-950"
                : "border border-slate-700 bg-slate-950 text-slate-300"
            }`}
          >
            Mở ô
          </button>
          <button
            type="button"
            onClick={() => setFlagMode(true)}
            className={`btn-fx rounded-xl px-4 py-2 text-sm font-semibold ${
              flagMode
                ? "bg-amber-500 text-slate-950"
                : "border border-slate-700 bg-slate-950 text-slate-300"
            }`}
          >
            🚩 Cắm cờ
          </button>
          <span className="text-xs text-slate-500">
            Chuột phải hoặc nút Cắm cờ · Cờ còn: {(room?.mineCount ?? 0) - (room?.me?.flagged ?? 0)}
          </span>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      {room?.board && (
        <div className="relative mx-auto w-max max-w-full overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-2 sm:p-3">
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${room.cols}, minmax(0, 1fr))` }}
          >
            {room.board.map((row, r) =>
              row.map((cell, c) => {
                let content: React.ReactNode = null;
                let cls = `${cellSize} flex items-center justify-center rounded-sm font-bold select-none `;
                if (cell.s === "hidden") {
                  cls += "bg-slate-700 hover:bg-slate-600 active:bg-slate-500";
                } else if (cell.s === "flag" || cell.s === "flag-mine") {
                  cls += "bg-slate-700";
                  content = "🚩";
                } else if (cell.s === "mine" || cell.s === "mine-hidden") {
                  cls += cell.s === "mine" ? "bg-rose-600 text-white" : "bg-slate-800";
                  content = "💣";
                } else if (cell.s === "open") {
                  cls += "bg-slate-950 ";
                  if (cell.n > 0) {
                    cls += NUM_COLORS[cell.n] || "text-slate-200";
                    content = cell.n;
                  }
                }
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    disabled={!canPlay || cell.s === "open" || cell.s === "mine"}
                    onClick={() => onCellClick(r, c)}
                    onContextMenu={(e) => onContextMenu(e, r, c)}
                    className={cls}
                  >
                    {content}
                  </button>
                );
              }),
            )}
          </div>

          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {reactions.map((re) => (
              <div
                key={re.id}
                className="absolute animate-bounce text-3xl"
                style={{ left: re.seat === "host" ? "12%" : "78%", top: "40%" }}
              >
                {emojiOf(re.emoji)}
              </div>
            ))}
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
              className="btn-fx rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xl hover:border-cyan-500"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {room?.phase === "finished" && (
        <div className="space-y-2 rounded-2xl border border-emerald-700/40 bg-slate-900/70 p-4">
          <p className="font-semibold text-emerald-200">{endLabel(room, seat)}</p>
          <p className="text-sm text-slate-400">Thời gian: {formatMs(room.elapsedMs)}</p>
          <button
            type="button"
            onClick={rematch}
            className="btn-fx rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Chơi lại
          </button>
          <p className="text-xs text-slate-500">Sau rematch cả hai phải Ready lại. Bản đồ mìn mới cùng độ khó.</p>
        </div>
      )}
    </div>
  );
}
