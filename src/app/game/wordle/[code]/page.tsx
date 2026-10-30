"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseRoom, ReactionBar, RoomHeader, useGameRoom } from "@/components/RoomKit";

type Mark = "correct" | "present" | "absent";
type WRoom = BaseRoom & {
  maxGuesses: number;
  winner: "host" | "guest" | "draw" | null;
  answer: string | null;
  startedAt: number | null;
  me: { guesses: { word: string; score: Mark[] }[]; solved: boolean; solvedMs: number | null } | null;
  opp: { rows: Mark[][]; words: string[] | null; solved: boolean; solvedMs: number | null } | null;
};

const COLOR: Record<Mark, string> = { correct: "#6aaa64", present: "#c9b458", absent: "#787c7e" };
const RANK: Record<Mark, number> = { absent: 1, present: 2, correct: 3 };
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const FLIP_MS = 300;
const STAGGER = 250;

export default function WordleRoomPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || "").toUpperCase();
  const { room, seat, error, setError, peerLeft, reactions, emit } = useGameRoom<WRoom>("wordle", code);
  const [input, setInput] = useState("");
  const [shake, setShake] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [animRow, setAnimRow] = useState<number | null>(null);
  const [keyLock, setKeyLock] = useState(false); // keyboard colours update after the flip
  const [bounce, setBounce] = useState(false);
  const prevCount = useRef(0);
  const toastId = useRef(0);

  const guesses = useMemo(() => room?.me?.guesses ?? [], [room?.me?.guesses]);
  const over = !!room?.winner;
  const playing = !!room?.started && !over;
  const done = !!room?.me && (room.me.solved || guesses.length >= (room.maxGuesses ?? 6));

  const showToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToast({ id, text });
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 1600);
  }, []);

  // detect a newly scored row -> flip animation, then bounce if solved
  useEffect(() => {
    const n = guesses.length;
    if (n > prevCount.current) {
      setAnimRow(n - 1);
      setKeyLock(true);
      const total = FLIP_MS + STAGGER * 4;
      const t1 = window.setTimeout(() => {
        setKeyLock(false);
        if (room?.me?.solved) setBounce(true);
      }, total);
      const t2 = window.setTimeout(() => setAnimRow(null), total + 1100);
      prevCount.current = n;
      return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    }
    if (n < prevCount.current) {
      prevCount.current = n;
      setBounce(false);
      setInput("");
    }
  }, [guesses.length, room?.me?.solved]);

  const submit = useCallback(() => {
    if (!playing || done) return;
    if (input.length < 5) {
      setShake(true); showToast("Chưa đủ 5 chữ cái"); window.setTimeout(() => setShake(false), 500);
      return;
    }
    emit("guess", { word: input }, (res) => {
      if (!res?.ok) {
        setShake(true);
        window.setTimeout(() => setShake(false), 500);
        showToast(res?.code === "invalid" ? "Không có trong từ điển" : res?.error || "Lỗi");
        return;
      }
      setInput("");
    });
  }, [playing, done, input, emit, showToast]);

  const press = useCallback(
    (k: string) => {
      if (!playing || done || animRow !== null && keyLock) return;
      if (k === "enter") return submit();
      if (k === "backspace") return setInput((s) => s.slice(0, -1));
      if (/^[a-z]$/.test(k)) setInput((s) => (s.length < 5 ? s + k : s));
    },
    [playing, done, submit, animRow, keyLock],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === "enter" || k === "backspace" || /^[a-z]$/.test(k)) {
        e.preventDefault();
        press(k);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const keyColors = useMemo(() => {
    const m: Record<string, Mark> = {};
    guesses.forEach((g, gi) => {
      if (keyLock && gi === guesses.length - 1) return;
      g.word.split("").forEach((ch, i) => {
        const s = g.score[i];
        if (!m[ch] || RANK[s] > RANK[m[ch]]) m[ch] = s;
      });
    });
    return m;
  }, [guesses, keyLock]);

  const status = useMemo(() => {
    if (!room) return "Đang kết nối…";
    if (room.winner) {
      if (room.winner === "draw") return room.me?.solved ? "Hòa — cùng số lượt và cùng thời gian!" : "Hòa — không ai đoán ra.";
      return room.winner === seat ? "🎉 Bạn thắng!" : "Đối thủ thắng.";
    }
    if (!room.started) return "Chờ cả hai bấm Ready.";
    if (room.me?.solved) return `Bạn đoán ra sau ${guesses.length} lượt — chờ đối thủ…`;
    if (done) return "Bạn đã hết lượt — chờ đối thủ…";
    return "Gõ từ 5 chữ cái rồi bấm Enter.";
  }, [room, seat, guesses.length, done]);

  const max = room?.maxGuesses ?? 6;

  return (
    <div className="space-y-4">
      <RoomHeader
        prefix="wordle" lobbyLabel="Lobby Wordle" title="Wordle" code={code} room={room} seat={seat}
        peerLeft={peerLeft} emit={emit} over={over}
      />
      {error && (
        <p onClick={() => setError(null)} className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>
      )}
      <p className="text-center text-sm font-medium text-slate-200">{status}</p>
      {over && room?.answer && (
        <p className="text-center text-lg">
          Từ bí mật: <span className="select-text font-mono text-2xl font-bold uppercase tracking-[0.3em] text-emerald-300">{room.answer}</span>
        </p>
      )}

      <div className="flex flex-col items-center gap-6 md:flex-row md:items-start md:justify-center">
        {/* my board */}
        <div className="relative">
          {toast && (
            <div key={toast.id} className="wd-toast absolute left-1/2 top-[-2.5rem] z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-900 shadow">
              {toast.text}
            </div>
          )}
          <div className="grid gap-1.5" style={{ perspective: 600 }}>
            {Array.from({ length: max }, (_, r) => {
              const g = guesses[r];
              const isCur = !g && r === guesses.length && playing && !done;
              const letters = g ? g.word : isCur ? input : "";
              return (
                <div key={r} className={`grid grid-cols-5 gap-1.5 ${isCur && shake ? "wd-shake" : ""}`}>
                  {Array.from({ length: 5 }, (_, i) => {
                    const ch = letters[i] || "";
                    const mark = g?.score[i];
                    const flipping = g && animRow === r;
                    const bouncing = g && bounce && r === guesses.length - 1 && room?.me?.solved;
                    const style: React.CSSProperties = mark
                      ? ({
                          ["--wd-c" as string]: COLOR[mark],
                          backgroundColor: COLOR[mark],
                          borderColor: COLOR[mark],
                          animationDelay: bouncing ? `${i * 100}ms` : flipping ? `${i * STAGGER}ms` : undefined,
                        } as React.CSSProperties)
                      : {};
                    return (
                      <div
                        key={`${i}-${ch}-${g ? "g" : "c"}`}
                        style={style}
                        className={`wd-tile flex h-12 w-12 items-center justify-center border-2 text-2xl font-extrabold uppercase text-white sm:h-14 sm:w-14 sm:text-3xl ${
                          mark ? "" : ch ? "wd-pop border-[#878a8c]" : "border-[#3a3a3c]"
                        } ${bouncing ? "wd-bounce" : flipping ? "wd-flip" : ""}`}
                      >
                        {ch}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* opponent board: colours only */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
            Đối thủ {room?.opp?.solved ? "✅" : ""}
          </p>
          <div className="grid gap-1">
            {Array.from({ length: max }, (_, r) => {
              const row = room?.opp?.rows[r];
              const word = room?.opp?.words?.[r];
              return (
                <div key={r} className="grid grid-cols-5 gap-1">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div
                      key={i}
                      className={`flex h-6 w-6 items-center justify-center rounded-sm border text-[11px] font-bold uppercase text-white transition-colors duration-300 ${row ? "border-transparent" : "border-[#3a3a3c]"}`}
                      style={row ? { backgroundColor: COLOR[row[i]] } : undefined}
                    >
                      {word?.[i] ?? ""}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* on-screen keyboard */}
      <div className="mx-auto max-w-lg space-y-1.5">
        {ROWS.map((row, ri) => (
          <div key={ri} className="flex justify-center gap-1.5">
            {ri === 2 && (
              <button type="button" onClick={() => press("enter")} className="btn-fx h-14 rounded-md bg-[#818384] px-3 text-xs font-bold text-white">
                ENTER
              </button>
            )}
            {row.split("").map((k) => {
              const m = keyColors[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  className="btn-fx h-14 min-w-0 flex-1 rounded-md text-sm font-bold uppercase text-white sm:max-w-[2.75rem]"
                  style={{ backgroundColor: m ? COLOR[m] : "#818384", transition: "background-color 0.3s, transform 0.2s" }}
                >
                  {k}
                </button>
              );
            })}
            {ri === 2 && (
              <button type="button" onClick={() => press("backspace")} aria-label="Xóa" className="btn-fx h-14 rounded-md bg-[#818384] px-3 text-lg font-bold text-white">
                ⌫
              </button>
            )}
          </div>
        ))}
      </div>

      <ReactionBar emit={emit} reactions={reactions} />
    </div>
  );
}
