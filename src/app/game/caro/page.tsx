"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import Link from "next/link";

const SIZES = [15, 30, 45] as const;

type RoomPayload = {
  ok: boolean;
  error?: string;
  room?: { code: string; size?: number };
};

export default function CaroLobbyPage() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [size, setSize] = useState<(typeof SIZES)[number]>(15);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function createRoom() {
    setError(null);
    setBusy(true);
    const socket = getSocket();
    if (!socket) {
      setBusy(false);
      setError("Không kết nối được socket.");
      return;
    }
    socket.emit("room:create", { size }, (res: RoomPayload) => {
      setBusy(false);
      if (!res?.ok || !res.room) {
        setError(res?.error || "Tạo phòng thất bại.");
        return;
      }
      router.push(`/game/caro/${res.room.code}`);
    });
  }

  function joinRoom(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError("Nhập mã phòng hợp lệ.");
      return;
    }
    setBusy(true);
    const socket = getSocket();
    if (!socket) {
      setBusy(false);
      setError("Không kết nối được socket.");
      return;
    }
    socket.emit("room:join", code, (res: RoomPayload) => {
      setBusy(false);
      if (!res?.ok || !res.room) {
        setError(res?.error || "Vào phòng thất bại.");
        return;
      }
      router.push(`/game/caro/${res.room.code}`);
    });
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link href="/" className="text-sm text-cyan-400 hover:underline">
          ← Về trang chủ
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Cờ Caro — phòng 2 người</h1>
        <p className="mt-1 text-sm text-slate-400">
          Thắng khi 5 quân liên tiếp <strong>không bị chặn 2 đầu</strong> (mép bàn hoặc quân địch đều tính là chặn).
          Host cầm X, người vào sau cầm O. Cả hai phải bấm Ready mới bắt đầu.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <p className="text-sm font-medium text-slate-300">Kích thước bàn (Host chọn khi tạo phòng)</p>
        <div className="flex flex-wrap gap-2">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                size === s
                  ? "border-cyan-400 bg-cyan-500 text-slate-950"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-600"
              }`}
            >
              {s}×{s}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={createRoom}
          className="w-full rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          Tạo phòng {size}×{size}
        </button>
      </div>

      <div className="relative text-center text-xs uppercase tracking-widest text-slate-500">
        <span className="bg-slate-950 px-2">hoặc</span>
        <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-slate-800" />
      </div>

      <form onSubmit={joinRoom} className="flex gap-2">
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="MA PHONG"
          maxLength={8}
          className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 tracking-[0.3em] text-cyan-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-fuchsia-500 px-5 font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-50"
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