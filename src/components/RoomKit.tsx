"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";

export type Seat = "host" | "guest";
export type BaseRoom = {
  code: string;
  hostSeated: boolean;
  guestSeated: boolean;
  hostReady: boolean;
  guestReady: boolean;
  started: boolean;
  score: { host: number; guest: number };
};
type Res<R> = { ok: boolean; error?: string; seat?: Seat; room?: R; [k: string]: unknown };

export const REACTIONS = [
  { id: "thumbsup", label: "👍" }, { id: "laugh", label: "😂" }, { id: "wow", label: "😮" }, { id: "fire", label: "🔥" },
  { id: "cry", label: "😢" }, { id: "party", label: "🎉" }, { id: "clap", label: "👏" }, { id: "heart", label: "❤️" },
];

/** Join/sync a room-kit room and keep it updated. */
export function useGameRoom<R extends BaseRoom>(prefix: string, code: string) {
  const [room, setRoom] = useState<R | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peerLeft, setPeerLeft] = useState(false);
  const [reactions, setReactions] = useState<{ id: number; emoji: string; seat: Seat }[]>([]);
  const rid = useRef(0);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onUpdate = (r: R) => {
      setRoom(r);
      if (r.hostSeated && r.guestSeated) setPeerLeft(false);
    };
    const onLeft = () => setPeerLeft(true);
    const onReact = (p: { emoji: string; seat: Seat }) => {
      const id = ++rid.current;
      setReactions((l) => [...l.slice(-8), { id, ...p }]);
      window.setTimeout(() => setReactions((l) => l.filter((x) => x.id !== id)), 2800);
    };
    socket.on(`${prefix}:update`, onUpdate);
    socket.on(`${prefix}:peer-left`, onLeft);
    socket.on(`${prefix}:reaction`, onReact);
    const accept = (res: Res<R>) => {
      if (!res?.ok || !res.room) return false;
      setRoom(res.room);
      setSeat(res.seat ?? null);
      return true;
    };
    socket.emit(`${prefix}:state`, (res: Res<R>) => {
      if (accept(res)) return;
      socket.emit(`${prefix}:join`, code, (j: Res<R>) => {
        if (!accept(j)) setError(j?.error || "Không vào được phòng.");
      });
    });
    return () => {
      socket.off(`${prefix}:update`, onUpdate);
      socket.off(`${prefix}:peer-left`, onLeft);
      socket.off(`${prefix}:reaction`, onReact);
    };
  }, [prefix, code]);

  const emit = useCallback(
    (event: string, payload?: unknown, onRes?: (res: Res<R>) => void) => {
      const socket = getSocket();
      const cb = (res: Res<R>) => {
        if (res?.ok && res.room) setRoom(res.room);
        if (onRes) onRes(res);
        else if (!res?.ok) setError(res?.error || "Có lỗi xảy ra.");
      };
      if (payload === undefined) socket?.emit(`${prefix}:${event}`, cb);
      else socket?.emit(`${prefix}:${event}`, payload, cb);
    },
    [prefix],
  );

  return { room, seat, error, setError, peerLeft, reactions, emit };
}

/** Header: back link, room code copy, session score, ready bar, peer-left notice. */
export function RoomHeader({
  title, code, room, seat, peerLeft, emit, over, onRematch, rematchLabel = "Chơi lại",
}: {
  prefix?: string; lobbyLabel?: string; title: string; code: string; room: BaseRoom | null; seat: Seat | null;
  peerLeft: boolean; emit: (e: string, p?: unknown) => void; over: boolean; onRematch?: () => void; rematchLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const bothSeated = !!(room?.hostSeated && room?.guestSeated);
  const myReady = seat === "host" ? room?.hostReady : room?.guestReady;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="mt-2 text-xl font-bold">
            {title} · Phòng <span className="select-text font-mono tracking-widest text-cyan-300">{code}</span>
          </h1>
          <p className="text-sm text-slate-400">Bạn là {seat === "host" ? "Chủ phòng" : seat === "guest" ? "Khách" : "…"}</p>
        </div>
        <div className="flex items-center gap-2">
          {room && (
            <span className="rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-1.5 font-mono text-sm">
              Bạn {seat === "guest" ? room.score.guest : room.score.host} : {seat === "guest" ? room.score.host : room.score.guest} Đối thủ
            </span>
          )}
          <button
            type="button"
            onClick={async () => {
              try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
            }}
            className="btn-fx rounded-xl border border-slate-700 px-3 py-2 text-sm hover:border-cyan-500"
          >
            {copied ? "Đã copy!" : "Copy mã phòng"}
          </button>
        </div>
      </div>
      {peerLeft && (
        <p className="rounded-2xl border-2 border-amber-400/70 bg-amber-950/50 px-4 py-3 text-sm text-amber-100">
          Đối thủ đã rời phòng / mất kết nối. Điểm phiên đã reset, chờ họ vào lại bằng mã <b>{code}</b>.
        </p>
      )}
      {room && !bothSeated && <p className="text-sm text-slate-400">Chờ đủ 2 người… Gửi mã phòng cho bạn của bạn.</p>}
      {room && bothSeated && !room.started && !over && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3">
          <div className="flex-1 text-sm text-slate-300">
            Ready: Chủ phòng {room.hostReady ? "✅" : "⏳"} · Khách {room.guestReady ? "✅" : "⏳"}
          </div>
          <button
            type="button"
            onClick={() => emit("ready", !myReady)}
            className={`btn-fx rounded-xl px-4 py-2 text-sm font-semibold ${
              myReady ? "border border-emerald-500 bg-emerald-950 text-emerald-200" : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            }`}
          >
            {myReady ? "Huỷ Ready" : "Ready"}
          </button>
        </div>
      )}
      {over && (
        <button
          type="button"
          onClick={onRematch ?? (() => emit("rematch"))}
          className="btn-fx rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400"
        >
          {rematchLabel}
        </button>
      )}
    </div>
  );
}

export function ReactionBar({ emit, reactions }: { emit: (e: string, p?: unknown) => void; reactions: { id: number; emoji: string; seat: Seat }[] }) {
  return (
    <div className="relative rounded-2xl border border-slate-800 bg-slate-900/50 px-3 py-3">
      <div className="pointer-events-none absolute inset-x-0 -top-10 h-10">
        {reactions.map((r) => (
          <span key={r.id} className="absolute animate-bounce text-3xl" style={{ left: r.seat === "host" ? "10%" : "80%" }}>
            {REACTIONS.find((x) => x.id === r.emoji)?.label}
          </span>
        ))}
      </div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Reaction nhanh</p>
      <div className="flex flex-wrap gap-2">
        {REACTIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => emit("react", r.id)}
            className="btn-fx rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xl hover:border-cyan-500"
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
