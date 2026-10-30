"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";

type RoomPayload = { ok: boolean; error?: string; room?: { code: string } };

/** Shared create/join lobby for the newer games (prefix = socket event prefix & route). */
export default function Lobby({
  prefix,
  title,
  children,
  createOpts,
}: {
  prefix: string;
  title: string;
  children?: React.ReactNode;
  createOpts?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done(res: RoomPayload, fallback: string) {
    setBusy(false);
    if (!res?.ok || !res.room) return setError(res?.error || fallback);
    router.push(`/game/${prefix}/${res.room.code}`);
  }
  function createRoom() {
    setError(null);
    const socket = getSocket();
    if (!socket) return setError("Không kết nối được socket.");
    setBusy(true);
    socket.emit(`${prefix}:create`, createOpts || {}, (res: RoomPayload) => done(res, "Tạo phòng thất bại."));
  }
  function joinRoom(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return setError("Nhập mã phòng hợp lệ.");
    const socket = getSocket();
    if (!socket) return setError("Không kết nối được socket.");
    setBusy(true);
    socket.emit(`${prefix}:join`, code, (res: RoomPayload) => done(res, "Vào phòng thất bại."));
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="mt-3 text-2xl font-bold">{title}</h1>
      </div>
      {children}
      <button
        type="button"
        disabled={busy}
        onClick={createRoom}
        className="btn-fx w-full rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
      >
        Tạo phòng mới
      </button>
      <div className="relative text-center text-xs uppercase tracking-widest text-slate-500">
        <span className="bg-slate-950 px-2">hoặc</span>
      </div>
      <form onSubmit={joinRoom} className="flex gap-2">
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="MÃ PHÒNG"
          maxLength={8}
          className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 tracking-[0.3em] text-cyan-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="btn-fx rounded-xl bg-fuchsia-500 px-5 font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-50"
        >
          Vào
        </button>
      </form>
      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>
      )}
    </div>
  );
}
