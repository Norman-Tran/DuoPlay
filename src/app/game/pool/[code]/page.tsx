"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSocket } from "@/lib/socket";

type Ball = {
  id: number;
  x: number;
  y: number;
  pocketed: boolean;
  type: string;
  /** server angular velocity (rad/s) during playback, server frame (x right, y down, z into table) */
  w?: [number, number, number];
};
type Spin = { a: number; b: number };
const MISCUE = 0.5;
const SQUIRT_MAX_DEG = 1.5;
const MU_SLIDE = 0.2;
const G_IN = 386.1;

type RoomState = {
  code: string;
  hostSeated: boolean;
  guestSeated: boolean;
  hostReady: boolean;
  guestReady: boolean;
  phase: "lobby" | "playing" | "animating" | "ball_in_hand" | "finished";
  turn: "A" | "B";
  winner: "A" | "B" | null;
  endReason: string | null;
  groups: { A: string | null; B: string | null };
  groupsAssigned: boolean;
  balls: Ball[];
  table: {
    w: number;
    h: number;
    ballR: number;
    pocketR: number;
    cushionW?: number;
    railW?: number;
    cornerA?: number;
    sideHalf?: number;
    headStringX?: number;
    footSpot?: { x: number; y: number };
  };
  pockets: { x: number; y: number; r?: number; kind?: string }[];
  cushions?: { x1: number; y1: number; x2: number; y2: number }[];
  jawTips?: { x: number; y: number; r: number }[];
  cushionPolys?: number[][][];
  turnDeadline: number | null;
  turnLimitSec: number;
  ballInHand: boolean;
  lastEvent: { type: string; message: string; at: number } | null;
  lastShotResult?: {
    seq: number;
    shooter: "A" | "B";
    nextTurn: "A" | "B";
    keptTurn: boolean;
    foul: boolean;
    reason: string | null;
    ballInHand: boolean;
    assignedGroups: { A: string | null; B: string | null } | null;
    winner: "A" | "B" | null;
    endReason: string | null;
  } | null;
  score: { A: number; B: number };
  isBreak: boolean;
  maxPower: number;
};

type Reaction = { id: number; emoji: string; seat: string; color: string };

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

/** Standard pool ball colours: 1 yellow, 2 blue, 3 red, 4 purple, 5 orange, 6 green, 7 maroon, 8 black; 9–15 stripes. */
const BALL_FILL: Record<number, string> = {
  0: "#f8f6ee",
  1: "#f6c21c",
  2: "#1f4fbf",
  3: "#d42a26",
  4: "#5b2a91",
  5: "#f07b16",
  6: "#13804a",
  7: "#7a1f1f",
  8: "#111111",
  9: "#f6c21c",
  10: "#1f4fbf",
  11: "#d42a26",
  12: "#5b2a91",
  13: "#f07b16",
  14: "#13804a",
  15: "#7a1f1f",
};

/** Max drag-back distance (CSS px) that maps to 100% power. Beyond it power stays 100%. */
const MAX_PULL_PX = 170;
/** Drags shorter than this cancel the shot instead of firing. */
const DEAD_ZONE_PX = 10;
/** How far the cue stick visually slides back at full power (table inches). */
const MAX_STICK_BACK_IN = 11;
/** Fine aim: Shift + mouse move rotates this many degrees per px; arrow keys step. */
const FINE_DEG_PER_PX = 0.1;
const ARROW_STEP_DEG = 0.2;
const STRIKE_MS = 110;
const CUE_LEN_IN = 57;
const TOAST_MS = 1600;
type Toast = {
  id: number;
  kind: "turn" | "lose-turn" | "group" | "win" | "lose" | "info";
  title: string;
  sub?: string;
  group?: string | null;
  side?: "A" | "B";
};
const POOL_FX_CSS = `
@keyframes pfx-pop{0%{transform:scale(.3);opacity:0}18%{transform:scale(1.15);opacity:1}30%{transform:scale(1)}80%{opacity:1}100%{transform:scale(1.05);opacity:0}}
@keyframes pfx-shake{0%{opacity:0;transform:translateX(0)}10%{opacity:1}15%,35%,55%{transform:translateX(-10px)}25%,45%,65%{transform:translateX(10px)}75%{transform:translateX(0);opacity:1}100%{opacity:0}}
@keyframes pfx-glow{0%,100%{text-shadow:0 0 8px rgba(52,211,153,.6)}50%{text-shadow:0 0 24px rgba(52,211,153,1),0 0 40px rgba(34,211,238,.7)}}
@keyframes pfx-fly-l{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(-42vw,0) scale(.6);opacity:0}}
@keyframes pfx-fly-r{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(42vw,0) scale(.6);opacity:0}}
@keyframes pfx-bar{0%,100%{box-shadow:0 0 6px rgba(52,211,153,.35)}50%{box-shadow:0 0 22px rgba(52,211,153,.95)}}
.pfx-pop{animation:pfx-pop 1.6s ease-out both}
.pfx-shake{animation:pfx-shake 1.6s ease-in-out both}
.pfx-glow{animation:pfx-glow .8s ease-in-out infinite}
.pfx-fly-l{animation:pfx-fly-l .7s ease-in .75s both}
.pfx-fly-r{animation:pfx-fly-r .7s ease-in .75s both}
.pfx-bar-pulse{animation:pfx-bar 1.2s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){
  .pfx-pop,.pfx-shake{animation:pfx-fade 1.6s linear both}
  .pfx-glow,.pfx-bar-pulse{animation:none}
  .pfx-fly-l,.pfx-fly-r{animation:none;opacity:0}
}
@keyframes pfx-fade{0%{opacity:0}10%,85%{opacity:1}100%{opacity:0}}
`;

type Vec3 = [number, number, number];
type Orient = { p: Vec3; s: Vec3 };
type ShotAnim = {
  shotId: number;
  ids: number[];
  fps: number;
  frames: number[][];
  stride?: number;
  start: number;
  durationMs: number;
};
type Aim = { active: boolean; angle: number; power: number; pullPx: number; downDist: number };

function rotate(v: Vec3, k: Vec3, th: number): Vec3 {
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const kx = k[0], ky = k[1], kz = k[2];
  const cx = ky * v[2] - kz * v[1];
  const cy = kz * v[0] - kx * v[2];
  const cz = kx * v[1] - ky * v[0];
  const d = (kx * v[0] + ky * v[1] + kz * v[2]) * (1 - c);
  const r: Vec3 = [v[0] * c + cx * sn + kx * d, v[1] * c + cy * sn + ky * d, v[2] * c + cz * sn + kz * d];
  const l = Math.hypot(r[0], r[1], r[2]) || 1;
  return [r[0] / l, r[1] / l, r[2] / l];
}

function initOrient(id: number): Orient {
  const a = id * 1.7;
  return { p: [0, 0, 1], s: [Math.cos(a), Math.sin(a), 0] };
}

function emojiOf(id: string) {
  return REACTIONS.find((r) => r.id === id)?.label || id;
}

function groupVi(g: string | null) {
  if (g === "solid") return "bi trơn 1–7";
  if (g === "stripe") return "bi sọc 9–15";
  return "chưa gán";
}

function endLabel(room: RoomState) {
  if (!room.winner) return "";
  const who = room.winner === "A" ? "Host (A)" : "Guest (B)";
  if (room.endReason === "eight") return `${who} thắng — bi 8 vào lỗ`;
  if (room.endReason === "eight-early") return `${who} thắng — đối thủ đưa bi 8 sớm`;
  if (room.endReason === "eight-scratch") return `${who} thắng — đối thủ bi 8 kèm phạm quy`;
  return `${who} thắng`;
}

/** Short aim preview: cue path to first hit + short object outbound (+ optional cue deflect). */
function computePreview(
  balls: Ball[],
  cue: Ball,
  angle: number,
  ballR: number,
  tableW: number,
  tableH: number,
  spin: Spin = { a: 0, b: 0 },
  speed = 67,
) {
  // Same squirt as the server: CB leaves slightly away from the english side.
  const ang = angle - ((SQUIRT_MAX_DEG * Math.PI) / 180) * (spin.a / MISCUE);
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const maxT = Math.hypot(tableW, tableH);
  let bestT = maxT;
  let hit: Ball | null = null;
  let hitNx = 0;
  let hitNy = 0;

  for (const b of balls) {
    if (b.pocketed || b.id === 0) continue;
    // Ray-circle: cue center moving along dir, collide when dist to b == 2R
    const fx = cue.x;
    const fy = cue.y;
    const ox = b.x - fx;
    const oy = b.y - fy;
    const proj = ox * dx + oy * dy;
    if (proj <= 0) continue;
    const closestX = fx + dx * proj;
    const closestY = fy + dy * proj;
    const distClosest = Math.hypot(b.x - closestX, b.y - closestY);
    const sumR = ballR * 2;
    if (distClosest >= sumR) continue;
    const back = Math.sqrt(Math.max(0, sumR * sumR - distClosest * distClosest));
    const t = proj - back;
    if (t > 0.05 && t < bestT) {
      bestT = t;
      hit = b;
      const cx = fx + dx * t;
      const cy = fy + dy * t;
      const nx = b.x - cx;
      const ny = b.y - cy;
      const nl = Math.hypot(nx, ny) || 1;
      hitNx = nx / nl;
      hitNy = ny / nl;
    }
  }

  // Also stop at cushion if no ball sooner
  let cushionT = maxT;
  if (dx > 0.001) cushionT = Math.min(cushionT, (tableW - ballR - cue.x) / dx);
  if (dx < -0.001) cushionT = Math.min(cushionT, (ballR - cue.x) / dx);
  if (dy > 0.001) cushionT = Math.min(cushionT, (tableH - ballR - cue.y) / dy);
  if (dy < -0.001) cushionT = Math.min(cushionT, (ballR - cue.y) / dy);

  const aimLen = Math.min(bestT, cushionT);
  const aimEnd = {
    x: cue.x + dx * Math.min(bestT, cushionT),
    y: cue.y + dy * Math.min(bestT, cushionT),
  };
  // Visual aim line stays short even if contact is far: draw up to min(contact, 70)
  const visualAimEnd = {
    x: cue.x + dx * Math.min(Math.min(bestT, cushionT), 70),
    y: cue.y + dy * Math.min(Math.min(bestT, cushionT), 70),
  };

  let objectLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  let cueDeflect: { x1: number; y1: number; x2: number; y2: number } | null = null;

  if (hit && bestT <= cushionT) {
    const short = 30;
    objectLine = {
      x1: hit.x,
      y1: hit.y,
      x2: hit.x + hitNx * short,
      y2: hit.y + hitNy * short,
    };
    // Cue deflect: tangent component direction (incoming - proj on normal), short
    const vn = dx * hitNx + dy * hitNy;
    let tx = dx - hitNx * vn;
    let ty = dy - hitNy * vn;
    const tl = Math.hypot(tx, ty);
    if (tl > 0.05) {
      tx /= tl;
      ty /= tl;
      cueDeflect = {
        x1: aimEnd.x,
        y1: aimEnd.y,
        x2: aimEnd.x + tx * 16,
        y2: aimEnd.y + ty * 16,
      };
    }
  }

  // Cue-ball path after contact (sliding -> rolling, Dr. Dave 2/7 rule generalised):
  // slide to the contact along d with spin, then keep the tangent velocity + the spin;
  // friction acts along the constant slip direction -> parabola, then roll along
  // v_f = 5/7 v_t + 2/7 s d (s = "roll speed" R*w along d).
  let cuePath: number[][] | null = null;
  if (hit && bestT <= cushionT) {
    const mg = MU_SLIDE * G_IN;
    let v = speed;
    let u = speed * (1 - 2.5 * spin.b);
    let dist = 0;
    const h = 1 / 240;
    while (dist < bestT && v > 0.6) {
      if (Math.abs(u) > 1e-3) {
        const du = 3.5 * mg * h;
        if (Math.abs(u) <= du) {
          v -= (2 / 7) * u;
          u = 0;
        } else {
          v -= mg * Math.sign(u) * h;
          u -= 3.5 * mg * Math.sign(u) * h;
        }
      } else {
        v -= (5 + 0.06 * v) * h;
      }
      dist += Math.max(0, v) * h;
    }
    if (v > 0.6) {
      const sRoll = v - u; // R*w component along d
      const vn = (dx * hitNx + dy * hitNy) * v;
      const vtx = dx * v - hitNx * vn;
      const vty = dy * v - hitNy * vn;
      const ux = vtx - sRoll * dx;
      const uy = vty - sRoll * dy;
      const us = Math.hypot(ux, uy);
      const pts: number[][] = [[aimEnd.x, aimEnd.y]];
      let x = aimEnd.x;
      let y = aimEnd.y;
      let fvx = vtx;
      let fvy = vty;
      if (us > 1e-3) {
        const axx = (-mg * ux) / us;
        const ayy = (-mg * uy) / us;
        const ts = us / (3.5 * mg);
        for (let i = 1; i <= 14; i++) {
          const tt = (ts * i) / 14;
          pts.push([aimEnd.x + vtx * tt + 0.5 * axx * tt * tt, aimEnd.y + vty * tt + 0.5 * ayy * tt * tt]);
        }
        x = pts[pts.length - 1][0];
        y = pts[pts.length - 1][1];
        fvx = (5 / 7) * vtx + (2 / 7) * sRoll * dx;
        fvy = (5 / 7) * vty + (2 / 7) * sRoll * dy;
      }
      const fl = Math.hypot(fvx, fvy);
      if (fl > 0.5) pts.push([x + (fvx / fl) * 14, y + (fvy / fl) * 14]);
      // keep the drawn path on the table
      cuePath = pts.map(([px0, py0]) => [
        Math.max(ballR, Math.min(tableW - ballR, px0)),
        Math.max(ballR, Math.min(tableH - ballR, py0)),
      ]);
    }
  }

  return { visualAimEnd, aimEnd, hit, objectLine, cueDeflect, aimLen, cuePath };
}

export default function PoolRoomPage() {
  const params = useParams();
  const code = String(params?.code || "").toUpperCase();

  const [room, setRoom] = useState<RoomState | null>(null);
  const [seat, setSeat] = useState<"host" | "guest" | null>(null);
  const [color, setColor] = useState<"A" | "B" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [animating, setAnimating] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const animRef = useRef<ShotAnim | null>(null);
  const aimRef = useRef<Aim>({ active: false, angle: 0, power: 0, pullPx: 0, downDist: 0 });
  const hoverAngleRef = useRef<number | null>(null);
  const oppAimRef = useRef<{ angle: number; power: number; active: boolean; spin?: Spin } | null>(null);
  const spinRef = useRef<Spin>({ a: 0, b: 0 });
  const [spin, setSpinState] = useState<Spin>({ a: 0, b: 0 });
  const [spinOpen, setSpinOpen] = useState(false);
  const spinOpenRef = useRef(false);
  spinOpenRef.current = spinOpen;
  const setSpin = useCallback((v: Spin) => {
    spinRef.current = v;
    setSpinState(v);
  }, []);
  const orientRef = useRef<Map<number, Orient>>(new Map());
  const lastPosRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const geomRef = useRef({ scale: 1, margin: 6 });
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const staticRef = useRef<{ key: string; cv: HTMLCanvasElement } | null>(null);
  const powerBarRef = useRef<HTMLDivElement | null>(null);
  const powerTxtRef = useRef<HTMLSpanElement | null>(null);
  const stickBackRef = useRef(0); // smoothed visual pull (table inches)
  const pendingShotRef = useRef<{ angle: number; back: number; spin?: Spin } | null>(null);
  const dragCueRef = useRef<{ x: number; y: number; valid: boolean } | null>(null);
  const pendingPlaceRef = useRef<{ x: number; y: number } | null>(null);
  const oppCueRef = useRef<{ x: number; y: number; valid: boolean; active: boolean } | null>(null);
  const placeLockedRef = useRef(false);
  const lastPlaceEmitRef = useRef(0);
  const [mounted, setMounted] = useState(false);
  const strikeRef = useRef<{ angle: number; back: number; x: number; y: number; start: number; spin?: Spin } | null>(null);
  const downPtRef = useRef<{ x: number; y: number } | null>(null);
  const canAimRef = useRef(false);
  const lastAimEmitRef = useRef(0);
  const lastFrameRef = useRef(0);
  const isMyTurnRef = useRef(false);
  const lastShotRef = useRef<{ angle: number; power: number } | null>(null);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const myColor = color;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const queueRef = useRef<Toast[]>([]);
  const showingRef = useRef(false);
  const seenSeqRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const pump = useCallback(() => {
    if (showingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    showingRef.current = true;
    setToasts([next]);
    setTimeout(() => {
      setToasts([]);
      showingRef.current = false;
      setTimeout(() => pump(), 80);
    }, TOAST_MS);
  }, []);
  const enqueue = useCallback(
    (t: Omit<Toast, "id">) => {
      queueRef.current.push({ ...t, id: Date.now() + Math.random() });
      pump();
    },
    [pump],
  );
  // Derive overlay messages from server state changes.
  useEffect(() => {
    if (!room || !color) return;
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = room.phase;
    const res = room.lastShotResult;
    if (seenSeqRef.current === null) {
      seenSeqRef.current = res?.seq ?? 0; // don't replay old events on join
      if (prevPhase === null) return;
    }
    if (prevPhase === "lobby" && room.phase === "playing") {
      if (room.turn === color) enqueue({ kind: "turn", title: "Tới lượt bạn!", sub: "Bạn phá bi" });
      else enqueue({ kind: "info", title: "Đối thủ phá bi" });
    }
    if (!res || res.seq === seenSeqRef.current) return;
    seenSeqRef.current = res.seq;
    const opp = color === "A" ? "B" : "A";
    if (res.assignedGroups) {
      const g = res.assignedGroups[color];
      enqueue({
        kind: "group",
        title: g === "solid" ? "Bạn đánh BI TRƠN (1–7)" : "Bạn đánh BI SỌC (9–15)",
        group: g,
        side: color,
      });
    }
    if (res.winner) {
      enqueue(
        res.winner === color
          ? { kind: "win", title: "🏆 Bạn thắng!", sub: endLabel(room) }
          : { kind: "lose", title: "Bạn thua", sub: endLabel(room) },
      );
      return;
    }
    if (res.keptTurn) {
      if (res.shooter === color) enqueue({ kind: "turn", title: "Vào bi — đánh tiếp!" });
      return;
    }
    if (res.nextTurn === color) {
      enqueue({
        kind: "turn",
        title: "Tới lượt bạn!",
        sub: res.ballInHand ? (res.foul && res.reason ? `Đối thủ phạm lỗi: ${res.reason.toLowerCase()} · ` : "") + "Bạn được đặt bi tự do" : undefined,
      });
    } else if (res.nextTurn === opp) {
      enqueue({
        kind: "lose-turn",
        title: "Mất lượt",
        sub: res.foul ? `Phạm lỗi: ${(res.reason || "").toLowerCase()} · Đối thủ được đặt bi` : undefined,
      });
    }
  }, [room, color, enqueue]);
  const colorRef = useRef<"A" | "B" | null>(null);
  colorRef.current = color;
  const isMyTurn =
    !!room &&
    !!myColor &&
    room.turn === myColor &&
    (room.phase === "playing" || room.phase === "ball_in_hand");

  isMyTurnRef.current = isMyTurn;
  useEffect(() => setMounted(true), []);
  const canAim = isMyTurn && room?.phase === "playing" && !room.winner && !animating;
  useEffect(() => {
    canAimRef.current = canAim;
    if (!canAim) aimRef.current.active = false;
  }, [canAim]);

  const secsLeft = useMemo(() => {
    if (!room?.turnDeadline) return null;
    return Math.max(0, Math.ceil((room.turnDeadline - now) / 1000));
  }, [room?.turnDeadline, now]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  const applyRoom = useCallback((r: RoomState, s?: "host" | "guest" | null, c?: "A" | "B" | null) => {
    setRoom(r);
    if (s !== undefined) setSeat(s);
    if (c !== undefined) setColor(c);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !code) return;

    function onUpdate(r: RoomState) {
      setRoom(r);
      setError(null);
      if (r.phase !== "animating") oppAimRef.current = null;
      pendingPlaceRef.current = null;
      oppCueRef.current = null;
      if (!r.ballInHand) placeLockedRef.current = false;
    }
    function onSnapshot(payload: { balls: Ball[]; phase: RoomState["phase"] }) {
      setRoom((prev) => (prev ? { ...prev, balls: payload.balls, phase: payload.phase } : prev));
    }
    function onShot(payload: { shotId: number; ids: number[]; fps: number; frames: number[][]; durationMs: number }) {
      const mine = pendingShotRef.current;
      const opp = oppAimRef.current;
      const rr = roomRef.current;
      const cb = rr?.balls.find((b) => b.id === 0 && !b.pocketed);
      const now = performance.now();
      const src = mine ?? (opp ? { angle: opp.angle, back: stickBackRef.current } : null);
      if (mine) {
        spinRef.current = { a: 0, b: 0 };
        setSpinState({ a: 0, b: 0 });
        setSpinOpen(false);
      }
      const sSpin = mine?.spin ?? opp?.spin;
      if (src && cb) strikeRef.current = { angle: src.angle, back: src.back, x: cb.x, y: cb.y, start: now, spin: sSpin };
      pendingShotRef.current = null;
      lastShotRef.current = null;
      oppAimRef.current = null;
      oppCueRef.current = null;
      aimRef.current.active = false;
      // Balls start rolling exactly when the cue tip reaches the ball.
      animRef.current = { ...payload, start: now + (src ? STRIKE_MS : 0) };
      setAnimating(true);
    }
    function onPlaceMove(payload: { x: number; y: number; valid: boolean; active: boolean }) {
      oppCueRef.current = payload;
    }
    function onAim(payload: { angle: number; power: number; active: boolean; spin?: Spin }) {
      oppAimRef.current = payload;
    }
    function onPeerLeft() {
      setError("Đối thủ đã rời phòng.");
    }
    function onReaction(payload: { emoji: string; seat: string; color: string }) {
      const id = Date.now() + Math.random();
      setReactions((prev) => [...prev, { id, emoji: emojiOf(payload.emoji), seat: payload.seat, color: payload.color }]);
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== id)), 2200);
    }

    const join = () => {
      socket.emit("pool:join", code, (res: { ok: boolean; error?: string; seat?: "host" | "guest"; color?: "A" | "B"; room?: RoomState }) => {
        if (!res?.ok || !res.room) {
          setError(res?.error || "Không vào được phòng.");
          return;
        }
        applyRoom(res.room, res.seat || null, res.color || null);
      });
    };

    socket.on("pool:update", onUpdate);
    socket.on("pool:snapshot", onSnapshot);
    socket.on("pool:shot", onShot);
    socket.on("pool:aim", onAim);
    socket.on("pool:place-move", onPlaceMove);
    socket.on("pool:peer-left", onPeerLeft);
    socket.on("pool:reaction", onReaction);
    if (socket.connected) join();
    else socket.on("connect", join);

    return () => {
      socket.off("pool:update", onUpdate);
      socket.off("pool:snapshot", onSnapshot);
      socket.off("pool:shot", onShot);
      socket.off("pool:aim", onAim);
      socket.off("pool:place-move", onPlaceMove);
      socket.off("pool:peer-left", onPeerLeft);
      socket.off("pool:reaction", onReaction);
      socket.off("connect", join);
    };
  }, [code, applyRoom]);

  /** Current ball positions: interpolated shot playback, else authoritative room state. */
  function currentBalls(r: RoomState, t: number): { balls: Ball[]; done: boolean } {
    const anim = animRef.current;
    if (!anim || anim.frames.length === 0) return { balls: r.balls, done: true };
    const S = anim.stride ?? 3;
    const started = t >= anim.start;
    const elapsed = Math.max(0, ((t - anim.start) / 1000) * anim.fps);
    const last = anim.frames.length - 1;
    const i0 = Math.max(0, Math.min(last, Math.floor(elapsed)));
    const i1 = Math.min(last, i0 + 1);
    const a = Math.max(0, Math.min(1, elapsed - i0));
    const f0 = anim.frames[i0];
    const f1 = anim.frames[i1];
    const types = new Map(r.balls.map((b) => [b.id, b.type]));
    const balls: Ball[] = anim.ids.map((id, k) => {
      const o = k * S;
      const pk = f1[o + 2] === 1;
      const x0 = f0[o] / 100;
      const y0 = f0[o + 1] / 100;
      const x1 = f1[o] / 100;
      const y1 = f1[o + 1] / 100;
      const w: [number, number, number] | undefined =
        S >= 6 && started
          ? [
              (f0[o + 3] + (f1[o + 3] - f0[o + 3]) * a) / 10,
              (f0[o + 4] + (f1[o + 4] - f0[o + 4]) * a) / 10,
              (f0[o + 5] + (f1[o + 5] - f0[o + 5]) * a) / 10,
            ]
          : undefined;
      return {
        id,
        x: pk ? x1 : x0 + (x1 - x0) * a,
        y: pk ? y1 : y0 + (y1 - y0) * a,
        pocketed: pk && f0[o + 2] === 1 ? true : pk && a > 0.5,
        type: types.get(id) || (id === 0 ? "cue" : id === 8 ? "eight" : id < 8 ? "solid" : "stripe"),
        w,
      };
    });
    return { balls, done: elapsed >= last };
  }

  // Render loop (requestAnimationFrame) reading refs, so playback is smooth and decoupled from React renders.
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      const r = roomRef.current;
      if (!canvas || !wrap || !r) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dtF = lastFrameRef.current ? Math.min(0.05, (t - lastFrameRef.current) / 1000) : 0;
      const cb0 = currentBalls(r, t);
      const done = cb0.done;
      const dragPos = dragCueRef.current ?? pendingPlaceRef.current ?? oppCueRef.current;
      const balls = dragPos && !animRef.current
        ? cb0.balls.map((b) => (b.id === 0 ? { ...b, x: dragPos.x, y: dragPos.y, pocketed: false } : b))
        : cb0.balls;
      if (done && animRef.current && r.phase !== "animating") {
        animRef.current = null;
        setAnimating(false);
      }

      const tw = r.table.w;
      const th = r.table.h;
      const R = r.table.ballR;
      const M = r.table.railW ?? Math.max(6, tw * 0.055);
      const CW = r.table.cushionW ?? 2;
      // Fit table to available width AND viewport height (keep 2:1 aspect).
      const availW = Math.max(240, wrap.clientWidth);
      const availH = Math.max(160, window.innerHeight - 170);
      const scale = Math.min(availW / (tw + 2 * M), availH / (th + 2 * M));
      const W = (tw + 2 * M) * scale;
      const H = (th + 2 * M) * scale;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;
      }
      geomRef.current = { scale, margin: M };
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * scale * M, dpr * scale * M);
      ctx.clearRect(-M, -M, tw + 2 * M, th + 2 * M);
      const px = 1 / scale; // one CSS pixel in table units

      // --- Static table layers (rails, cloth, pockets, cushions, sights) cached offscreen
      const key = `${canvas.width}x${canvas.height}`;
      if (!staticRef.current || staticRef.current.key !== key) {
        const cv = document.createElement("canvas");
        cv.width = canvas.width;
        cv.height = canvas.height;
        const sctx = cv.getContext("2d");
        if (sctx) {
          sctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * scale * M, dpr * scale * M);
          drawStaticTable(sctx, r, M, CW, px, dpr * scale);
        }
        staticRef.current = { key, cv };
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(staticRef.current.cv, 0, 0);
      ctx.restore();

      // --- Aim guide (my aim or opponent's live aim)
      const cue = balls.find((b) => b.id === 0 && !b.pocketed);
      const my = aimRef.current;
      let aimAngle: number | null = null;
      let aimPower = 0;
      let aimSpin: Spin = spinRef.current;
      let showStick = false;
      if (dragCueRef.current) {
        // dragging the cue ball: no aim
      } else if (cue && canAimRef.current && !animRef.current) {
        if (my.active) {
          aimAngle = my.angle;
          aimPower = my.power;
          showStick = true;
        } else if (hoverAngleRef.current != null) {
          aimAngle = hoverAngleRef.current;
          showStick = true;
        }
      } else if (cue && !animRef.current && r.phase === "playing" && oppAimRef.current?.active) {
        aimAngle = oppAimRef.current.angle;
        aimPower = oppAimRef.current.power;
        aimSpin = oppAimRef.current.spin ?? { a: 0, b: 0 };
        showStick = true;
      }
      if (cue && aimAngle != null) {
        const maxSp = r.isBreak ? 400 : r.maxPower || 130;
        const pv = aimPower > 0.02 ? aimPower : 0.5;
        const prev = computePreview(balls, cue, aimAngle, R, tw, th, aimSpin, 4 + (maxSp - 4) * pv);
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = px * 1.4;
        ctx.setLineDash([px * 5, px * 4]);
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(prev.aimEnd.x, prev.aimEnd.y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (prev.hit) {
          ctx.beginPath();
          ctx.arc(prev.aimEnd.x, prev.aimEnd.y, R, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = px * 1.2;
          ctx.stroke();
        }
        if (prev.objectLine) {
          ctx.strokeStyle = "rgba(253, 224, 71, 0.9)";
          ctx.lineWidth = px * 2;
          ctx.beginPath();
          ctx.moveTo(prev.objectLine.x1, prev.objectLine.y1);
          ctx.lineTo(prev.objectLine.x2, prev.objectLine.y2);
          ctx.stroke();
        }
        if (prev.cuePath && prev.cuePath.length > 1) {
          ctx.strokeStyle = "rgba(165, 243, 252, 0.8)";
          ctx.lineWidth = px * 1.6;
          ctx.setLineDash([px * 3, px * 3]);
          ctx.beginPath();
          ctx.moveTo(prev.cuePath[0][0], prev.cuePath[0][1]);
          for (const q of prev.cuePath.slice(1)) ctx.lineTo(q[0], q[1]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (prev.cueDeflect) {
          ctx.strokeStyle = "rgba(165, 243, 252, 0.75)";
          ctx.lineWidth = px * 1.5;
          ctx.beginPath();
          ctx.moveTo(prev.cueDeflect.x1, prev.cueDeflect.y1);
          ctx.lineTo(prev.cueDeflect.x2, prev.cueDeflect.y2);
          ctx.stroke();
        }
      }

      // --- Balls with rolling orientation
      const orient = orientRef.current;
      const lastPos = lastPosRef.current;
      for (const b of balls) {
        if (b.pocketed) {
          lastPos.delete(b.id);
          continue;
        }
        let o = orient.get(b.id);
        if (!o) {
          o = initOrient(b.id);
          orient.set(b.id, o);
        }
        const lp = lastPos.get(b.id);
        if (b.w && animRef.current) {
          // Real angular velocity from the server (shows draw / follow / side spin).
          // Server frame z points into the table; client sphere frame z points to the viewer.
          const k0: Vec3 = [-b.w[0], -b.w[1], b.w[2]];
          const wm = Math.hypot(k0[0], k0[1], k0[2]);
          if (wm > 1e-3 && dtF > 0) {
            const k: Vec3 = [k0[0] / wm, k0[1] / wm, k0[2] / wm];
            o = { p: rotate(o.p, k, wm * dtF), s: rotate(o.s, k, wm * dtF) };
            orient.set(b.id, o);
          }
        } else if (lp) {
          const dx = b.x - lp.x;
          const dy = b.y - lp.y;
          const dd = Math.hypot(dx, dy);
          if (dd > 1e-4 && dd < 6) {
            const k: Vec3 = [-dy / dd, dx / dd, 0];
            const th2 = dd / R;
            o = { p: rotate(o.p, k, th2), s: rotate(o.s, k, th2) };
            orient.set(b.id, o);
          }
        }
        lastPos.set(b.id, { x: b.x, y: b.y });
        drawBall(ctx, b, o, R, px, tw / 2, th / 2);
        if (b.id === 0 && dragPos) {
          const valid = dragCueRef.current ? dragCueRef.current.valid : oppCueRef.current ? oppCueRef.current.valid : true;
          ctx.beginPath();
          ctx.arc(b.x, b.y, R + 0.35, 0, Math.PI * 2);
          ctx.fillStyle = valid ? "rgba(34,197,94,0.22)" : "rgba(239,68,68,0.3)";
          ctx.fill();
          ctx.strokeStyle = valid ? "rgba(74,222,128,0.95)" : "rgba(248,113,113,0.95)";
          ctx.lineWidth = px * 2;
          ctx.stroke();
        } else if (b.id === 0 && r.ballInHand && isMyTurnRef.current && !placeLockedRef.current && !animRef.current) {
          ctx.beginPath();
          ctx.arc(b.x, b.y, R + 0.3, 0, Math.PI * 2);
          ctx.setLineDash([px * 4, px * 3]);
          ctx.strokeStyle = "rgba(255,255,255,0.75)";
          ctx.lineWidth = px * 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // --- Cue stick on a body-level overlay (portal, so no transformed ancestor can
      // offset position:fixed). Same transform as the table canvas, recomputed every frame.
      const ov = overlayRef.current;
      if (ov) {
        const vw = document.documentElement.clientWidth;
        const vh = window.innerHeight;
        if (ov.width !== Math.round(vw * dpr) || ov.height !== Math.round(vh * dpr)) {
          ov.width = Math.round(vw * dpr);
          ov.height = Math.round(vh * dpr);
          ov.style.width = `${vw}px`;
          ov.style.height = `${vh}px`;
        }
        const octx = ov.getContext("2d");
        if (octx) {
          octx.setTransform(1, 0, 0, 1, 0, 0);
          octx.clearRect(0, 0, ov.width, ov.height);
          const rect = canvas.getBoundingClientRect();
          const sx = rect.width / W; // CSS-size sanity (1 unless zoomed)
          octx.setTransform(dpr * scale * sx, 0, 0, dpr * scale * sx, dpr * (rect.left + scale * sx * M), dpr * (rect.top + scale * sx * M));
          const dt = lastFrameRef.current ? Math.min(0.05, (t - lastFrameRef.current) / 1000) : 0.016;
          const st = strikeRef.current;
          const pend = pendingShotRef.current;
          if (st) {
            const k = (t - st.start) / STRIKE_MS;
            if (k >= 1.5) strikeRef.current = null;
            else {
              // ease-in forward stroke to contact, short follow-through, then hide
              const back = k < 1 ? st.back * (1 - k * k) : -0.6 * (k - 1) * 2;
              octx.globalAlpha = k < 1 ? 1 : Math.max(0, 1 - (k - 1) * 2);
              drawCue(octx, st.x, st.y, st.angle, R + 0.05 + back, px, st.spin, R);
              octx.globalAlpha = 1;
            }
            stickBackRef.current = 0;
          } else if (pend && cue) {
            drawCue(octx, cue.x, cue.y, pend.angle, R + 0.35 + pend.back, px, pend.spin, R);
          } else if (cue && aimAngle != null && showStick && !animRef.current) {
            const target = aimPower * MAX_STICK_BACK_IN;
            stickBackRef.current += (target - stickBackRef.current) * Math.min(1, dt * 30);
            drawCue(octx, cue.x, cue.y, aimAngle, R + 0.35 + stickBackRef.current, px, aimSpin, R);
          } else {
            stickBackRef.current = 0;
          }
        }
      }
      lastFrameRef.current = t;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPowerDom(v: number) {
    if (powerBarRef.current) powerBarRef.current.style.width = `${Math.round(v * 100)}%`;
    if (powerTxtRef.current) powerTxtRef.current.textContent = `${Math.round(v * 100)}%`;
  }

  function tableCoords(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { scale, margin } = geomRef.current;
    return { x: (clientX - rect.left) / scale - margin, y: (clientY - rect.top) / scale - margin };
  }

  function emitAim(force = false) {
    const t = performance.now();
    if (!force && t - lastAimEmitRef.current < 50) return;
    lastAimEmitRef.current = t;
    const a = aimRef.current;
    getSocket()?.emit("pool:aim", { angle: a.angle, power: a.power, active: a.active, spin: spinRef.current });
  }

  /** Hover: shot direction = cue-ball centre -> pointer (anywhere on the page).
   *  Dragging: direction locked; pulling the pointer back (opposite to the shot) adds power. */
  function updateAim(clientX: number, clientY: number, fineDx = 0, fine = false) {
    const r = roomRef.current;
    const cue = r?.balls.find((b) => b.id === 0 && !b.pocketed);
    const pt = tableCoords(clientX, clientY);
    if (!cue || !pt) return;
    const a = aimRef.current;
    if (a.active) {
      const d0 = downPtRef.current || pt;
      const pull = ((d0.x - pt.x) * Math.cos(a.angle) + (d0.y - pt.y) * Math.sin(a.angle)) * geomRef.current.scale;
      a.pullPx = Math.min(MAX_PULL_PX, Math.max(0, pull));
      a.power = a.pullPx / MAX_PULL_PX;
      if (a.pullPx >= DEAD_ZONE_PX) placeLockedRef.current = true;
      setPowerDom(a.power);
      emitAim();
      return;
    }
    if (fine && hoverAngleRef.current != null) {
      hoverAngleRef.current += (fineDx * FINE_DEG_PER_PX * Math.PI) / 180;
    } else {
      if (Math.hypot(pt.x - cue.x, pt.y - cue.y) < 0.3) return;
      hoverAngleRef.current = Math.atan2(pt.y - cue.y, pt.x - cue.x);
    }
  }

  function validPlacement(r: RoomState, x: number, y: number) {
    const R = r.table.ballR;
    if (x < R || x > r.table.w - R || y < R || y > r.table.h - R) return false;
    if (r.pockets.some((p) => Math.hypot(x - p.x, y - p.y) < (r.table.pocketR ?? 2.35) + R)) return false;
    return !r.balls.some((b) => b.id !== 0 && !b.pocketed && Math.hypot(b.x - x, b.y - y) < R * 2 + 0.2);
  }

  function onPointerDown(e: React.PointerEvent) {
    const r = roomRef.current;
    if (!r || !isMyTurn || animRef.current || e.button > 0) return;
    const pt = tableCoords(e.clientX, e.clientY);
    if (!pt) return;
    const cue = r.balls.find((b) => b.id === 0 && !b.pocketed);
    const cuePos = pendingPlaceRef.current ?? cue;
    // Ball in hand: press & hold on the cue ball to drag it (until a cue pull starts).
    if (r.ballInHand && !placeLockedRef.current && cuePos && Math.hypot(pt.x - cuePos.x, pt.y - cuePos.y) < r.table.ballR * 2) {
      dragCueRef.current = { x: cuePos.x, y: cuePos.y, valid: validPlacement(r, cuePos.x, cuePos.y) };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (r.phase === "ball_in_hand") return;
    if (!canAimRef.current || !cue) return;
    // Lock the aim direction at drag start.
    const lockAngle = hoverAngleRef.current ?? Math.atan2(pt.y - cue.y, pt.x - cue.x);
    hoverAngleRef.current = lockAngle;
    downPtRef.current = pt;
    aimRef.current = { active: true, angle: lockAngle, power: 0, pullPx: 0, downDist: 0 };
    setPowerDom(0);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function moveDragCue(clientX: number, clientY: number, final: boolean) {
    const r = roomRef.current;
    const d = dragCueRef.current;
    const pt = tableCoords(clientX, clientY);
    if (!r || !d || !pt) return;
    const R = r.table.ballR;
    d.x = Math.max(R, Math.min(r.table.w - R, pt.x));
    d.y = Math.max(R, Math.min(r.table.h - R, pt.y));
    d.valid = validPlacement(r, d.x, d.y);
    const now = performance.now();
    if (final || now - lastPlaceEmitRef.current > 50) {
      lastPlaceEmitRef.current = now;
      getSocket()?.emit("pool:place-move", { x: d.x, y: d.y, active: !final });
    }
  }

  function releaseDragCue(clientX: number, clientY: number) {
    const d = dragCueRef.current;
    if (!d) return;
    moveDragCue(clientX, clientY, true);
    dragCueRef.current = null;
    if (!d.valid) {
      setError("Vị trí đặt bi chủ không hợp lệ.");
      return;
    }
    pendingPlaceRef.current = { x: d.x, y: d.y };
    getSocket()?.emit("pool:place-cue", { x: d.x, y: d.y }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) {
        pendingPlaceRef.current = null;
        setError(res?.error || "Không đặt được bi chủ.");
      } else setError(null);
    });
  }

  // Window-level pointer tracking so aiming works with the mouse anywhere on the page.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragCueRef.current) {
        moveDragCue(e.clientX, e.clientY, false);
        return;
      }
      if (!canAimRef.current || spinOpenRef.current) return;
      updateAim(e.clientX, e.clientY, e.movementX + e.movementY, e.shiftKey);
    };
    const up = (e: PointerEvent) => {
      if (dragCueRef.current) releaseDragCue(e.clientX, e.clientY);
      else onPointerUpWin(e.clientX, e.clientY);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cancelAim() {
    aimRef.current.active = false;
    aimRef.current.power = 0;
    setPowerDom(0);
    emitAim(true);
  }

  function onPointerUpWin(clientX: number, clientY: number) {
    const a = aimRef.current;
    if (!a.active) return;
    updateAim(clientX, clientY);
    a.active = false;
    downPtRef.current = null;
    const r = roomRef.current;
    const mine = !!r && r.turn === colorRef.current && r.phase === "playing";
    if (a.pullPx < DEAD_ZONE_PX || !mine) {
      cancelAim();
      return;
    }
    const shot = { angle: a.angle, power: a.power, spin: { ...spinRef.current } };
    lastShotRef.current = shot;
    pendingShotRef.current = { angle: a.angle, back: stickBackRef.current, spin: { ...spinRef.current } };
    a.power = 0;
    setPowerDom(0);
    getSocket()?.emit("pool:shoot", shot, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) {
        lastShotRef.current = null;
        pendingShotRef.current = null;
        setError(res?.error || "Bắn thất bại.");
      }
    });
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && aimRef.current.active) cancelAim();
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key) && canAimRef.current && !aimRef.current.active) {
        if (hoverAngleRef.current == null) return;
        const dir = ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 1;
        const step = ((ev.shiftKey ? 1 : ARROW_STEP_DEG) * Math.PI) / 180;
        hoverAngleRef.current += dir * step;
        ev.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleReady() {
    if (!room) return;
    const socket = getSocket();
    const next = seat === "host" ? !room.hostReady : !room.guestReady;
    socket?.emit("pool:ready", next, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error || "Ready thất bại.");
    });
  }

  function rematch() {
    const socket = getSocket();
    socket?.emit("pool:rematch", {}, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error || "Rematch thất bại.");
    });
  }

  function sendReact(id: string) {
    getSocket()?.emit("pool:react", id);
  }

  const myReady = seat === "host" ? room?.hostReady : room?.guestReady;

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-3 px-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/game/pool" className="text-sm text-cyan-400 hover:underline">
            ← Lobby bida
          </Link>
          <h1 className="mt-1 text-xl font-bold">
            Phòng <span className="font-mono tracking-widest text-cyan-300">{code}</span>
          </h1>
          <p className="text-sm text-slate-400">
            Bạn: {seat === "host" ? "Host (A)" : seat === "guest" ? "Guest (B)" : "…"}
            {room?.groupsAssigned && myColor
              ? ` · nhóm ${groupVi(room.groups[myColor])}`
              : ""}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm">
          <div>
            Điểm A {room?.score.A ?? 0} — {room?.score.B ?? 0} B
          </div>
          <div className="text-xs text-slate-500">
            Host {room?.hostSeated ? (room.hostReady ? "● Ready" : "○") : "—"} · Guest{" "}
            {room?.guestSeated ? (room.guestReady ? "● Ready" : "○") : "—"}
          </div>
        </div>
      </div>

      {room && (room.phase === "playing" || room.phase === "ball_in_hand" || room.phase === "animating") && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm">
          <span>
            Lượt:{" "}
            <strong className={room.turn === myColor ? "text-emerald-300" : "text-amber-200"}>
              {room.turn === "A" ? "Host (A)" : "Guest (B)"}
            </strong>
            {room.ballInHand && room.turn === myColor && " · bi trong tay: nhấn giữ bi chủ để kéo đặt lại (trước khi kéo cơ)"}
            {(room.phase === "animating" || animating) && " · bi đang chạy…"}
          </span>
          {secsLeft != null && room.phase !== "animating" && (
            <span
              className={`ml-auto font-mono text-lg font-bold ${
                secsLeft <= 10 ? "text-rose-400" : "text-cyan-300"
              }`}
            >
              {secsLeft}s
            </span>
          )}
        </div>
      )}

      <p className="min-h-[1.25rem] truncate text-sm text-slate-300">{room?.lastEvent?.message ?? ""}</p>

      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        <style>{POOL_FX_CSS}</style>
        <RackBar room={room} color="A" mine={myColor === "A"} />
        <div ref={wrapRef} className="relative min-w-0 flex-1 rounded-2xl border border-emerald-900/40 bg-slate-950 p-1">
          <ToastLayer toasts={toasts} />
          <SpinPicker
            spin={spin}
            open={spinOpen}
            disabled={!canAim}
            onOpen={() => setSpinOpen(true)}
            onClose={() => setSpinOpen(false)}
            onChange={(v) => {
              setSpin(v);
              if (aimRef.current.active) emitAim(true);
            }}
          />
          <canvas
            ref={canvasRef}
            className="mx-auto block touch-none"
            onPointerDown={onPointerDown}
            onPointerCancel={cancelAim}
            onContextMenu={(e) => {
              e.preventDefault();
              cancelAim();
            }}
          />
        </div>
        <RackBar room={room} color="B" mine={myColor === "B"} />
      </div>
      {mounted &&
        createPortal(
          <canvas ref={overlayRef} className="pointer-events-none fixed left-0 top-0 z-40" />,
          document.body,
        )}

      {room?.phase === "lobby" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleReady}
            className={`rounded-xl px-4 py-2 font-semibold ${
              myReady
                ? "bg-emerald-500 text-slate-950"
                : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
            }`}
          >
            {myReady ? "Đã Ready — bấm để hủy" : "Ready"}
          </button>
          <p className="self-center text-sm text-slate-400">Cả hai Ready để bắt đầu. Host phá bi trước.</p>
        </div>
      )}

      {isMyTurn && room?.phase === "playing" && !animating && (
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300">Lực</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                ref={powerBarRef}
                className="h-full rounded-full"
                style={{
                  width: "0%",
                  background: "linear-gradient(90deg,#22c55e,#eab308 60%,#ef4444)",
                }}
              />
            </div>
            <span ref={powerTxtRef} className="w-12 text-right font-mono text-cyan-300">0%</span>
          </div>
          <p className="text-xs text-slate-500">
            Di chuột (ở bất kỳ đâu trên trang) để ngắm: hướng đánh là từ bi chủ tới con trỏ. Giữ Shift khi di chuột để
            ngắm tinh (0.1°/px), hoặc dùng phím mũi tên (0.2°/lần). Nhấn giữ chuột trên bàn để khóa hướng, kéo lùi lại để
            lấy đà (tối đa 100% ở {MAX_PULL_PX}px), thả ra để đánh; kéo quá ngắn hoặc chuột phải / Esc để hủy. Bi mờ =
            vị trí bi chủ lúc chạm; line vàng = hướng bi bị chạm; line xanh nhạt = bi chủ sau va chạm.
          </p>
        </div>
      )}

      {room?.phase === "finished" && (
        <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4">
          <p className="text-lg font-semibold text-amber-100">{endLabel(room)}</p>
          <button
            type="button"
            onClick={rematch}
            className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Chơi lại
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {REACTIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => sendReact(r.id)}
            className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-lg hover:border-cyan-600"
            title={r.id}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="pointer-events-none fixed bottom-8 right-8 flex flex-col items-end gap-2">
        {reactions.map((r) => (
          <span key={r.id} className="animate-bounce text-3xl">
            {r.emoji}
          </span>
        ))}
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- Per-pixel sphere renderer (fixes overlapping stripe caps) ----
function hexRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) return [226, 232, 240];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const WHITE: [number, number, number] = [248, 246, 238];
const STRIPE_HALF = 0.5; // stripe band |n·s| < 0.5 → caps white
const SPOT_COS = Math.cos(0.5); // number spot angular radius
const DOT_COS = Math.cos(0.16);
const LIGHT: Vec3 = (() => { const l = [-0.45, -0.5, 0.74]; const m = Math.hypot(l[0], l[1], l[2]); return [l[0] / m, l[1] / m, l[2] / m] as Vec3; })();

/** Fill RGBA buffer (N×N) with a shaded sphere view. Exported shape kept pure for testing. */
function shadeBallPixels(data: Uint8ClampedArray, N: number, id: number, col: string, o: Orient) {
  const base = hexRgb(col);
  const stripe = id >= 9 && id <= 15;
  const [px0, py0, pz0] = o.p;
  const [sx, sy, sz] = o.s;
  const ss = 2; // 2×2 supersampling
  const inv = 1 / (N / 2);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let r = 0, g = 0, bl = 0, cov = 0;
      for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
        const u = (i + (si + 0.5) / ss) * inv - 1;
        const v = (j + (sj + 0.5) / ss) * inv - 1;
        const q = u * u + v * v;
        if (q > 1) continue;
        const w = Math.sqrt(1 - q);
        let c = base;
        if (id === 0) {
          if (u * px0 + v * py0 + w * pz0 > DOT_COS) c = [200, 30, 30];
          else c = WHITE;
        } else {
          if (stripe && Math.abs(u * sx + v * sy + w * sz) > STRIPE_HALF) c = WHITE;
          if (u * px0 + v * py0 + w * pz0 > SPOT_COS) c = WHITE;
        }
        const nd = Math.max(0, u * LIGHT[0] + v * LIGHT[1] + w * LIGHT[2]);
        const dif = 0.35 + 0.65 * nd;
        const hz = LIGHT[2] + 1; // half-vector with view (0,0,1)
        const hm = Math.hypot(LIGHT[0], LIGHT[1], hz);
        const sp = Math.pow(Math.max(0, (u * LIGHT[0] + v * LIGHT[1] + w * hz) / hm), 40) * 0.85;
        r += c[0] * dif + 255 * sp; g += c[1] * dif + 255 * sp; bl += c[2] * dif + 255 * sp; cov++;
      }
      const k = (j * N + i) * 4;
      if (cov) { data[k] = r / cov; data[k + 1] = g / cov; data[k + 2] = bl / cov; }
      data[k + 3] = (cov / (ss * ss)) * 255;
    }
  }
}

const ballCanvasCache = new Map<number, { cv: HTMLCanvasElement; c2: CanvasRenderingContext2D; img: ImageData }>();
function ballSurface(N: number) {
  let e = ballCanvasCache.get(N);
  if (!e) {
    const cv = document.createElement("canvas");
    cv.width = N; cv.height = N;
    const c2 = cv.getContext("2d")!;
    e = { cv, c2, img: c2.createImageData(N, N) };
    ballCanvasCache.set(N, e);
  }
  return e;
}

/** Draw a ball in table units using a true sphere projection of its 3D orientation. */
function drawBall(ctx: CanvasRenderingContext2D, b: Ball, o: Orient, R: number, px: number, lx = 50, ly = 25) {
  const { x, y } = b;
  // Soft shadow cast away from the overhead lamp (above table centre).
  const ox = (x - lx) * 0.012;
  const oy = (y - ly) * 0.012 + R * 0.12;
  const sx = x + ox;
  const sy = y + oy;
  const sg = ctx.createRadialGradient(sx, sy, R * 0.2, sx, sy, R * 1.35);
  sg.addColorStop(0, "rgba(0,0,0,0.42)");
  sg.addColorStop(0.6, "rgba(0,0,0,0.2)");
  sg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.arc(sx, sy, R * 1.35, 0, Math.PI * 2);
  ctx.fillStyle = sg;
  ctx.fill();

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const N = Math.max(8, Math.min(72, Math.ceil(((2 * R) / px) * dpr)));
  const surf = ballSurface(N);
  shadeBallPixels(surf.img.data, N, b.id, BALL_FILL[b.id] || "#e2e8f0", o);
  surf.c2.putImageData(surf.img, 0, 0);
  ctx.drawImage(surf.cv, x - R, y - R, 2 * R, 2 * R);

  if (b.id !== 0 && o.p[2] > 0.25) {
    ctx.save();
    ctx.translate(x + o.p[0] * R * 0.88, y + o.p[1] * R * 0.88);
    ctx.rotate(Math.atan2(o.p[1], o.p[0]));
    ctx.scale(Math.max(0.2, o.p[2]), 1);
    ctx.rotate(-Math.atan2(o.p[1], o.p[0]));
    ctx.fillStyle = "#111";
    ctx.font = `bold ${R * 0.62}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(b.id), 0, R * 0.03);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = px * 0.8;
  ctx.stroke();
}

/** Realistic cue: tip, ferrule, maple shaft, joint, wrapped butt, bumper; drawn with shadow. */
function drawCue(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  gap: number,
  px: number,
  spin?: Spin,
  R = 1.125,
) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Side english: the cue axis shifts parallel to the shooter's right by a*R; the
  // tip still points along the aim line. Vertical offset shown as a small tip dot.
  const sa = spin?.a ?? 0;
  const sb = spin?.b ?? 0;
  const rx = -dy;
  const ry = dx;
  // tip touches the sphere at lateral offset a*R -> it sits a bit closer to the centre plane
  const lateral = sa * R;
  const depth = Math.sqrt(Math.max(0, R * R - lateral * lateral));
  const tipX = cx + rx * lateral - dx * (gap - R + depth);
  const tipY = cy + ry * lateral - dy * (gap - R + depth);
  const L = CUE_LEN_IN;
  const nx = -dy;
  const ny = dx;
  const at = (s: number) => [tipX - dx * s, tipY - dy * s] as const;
  const halfW = (s: number) => 0.26 + (0.62 - 0.26) * Math.pow(s / L, 1.3);
  const band = (s0: number, s1: number, fill: string | CanvasGradient) => {
    const [x0, y0] = at(s0);
    const [x1, y1] = at(s1);
    const w0 = halfW(s0);
    const w1 = halfW(s1);
    ctx.beginPath();
    ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
    ctx.lineTo(x1 + nx * w1, y1 + ny * w1);
    ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
    ctx.lineTo(x0 - nx * w0, y0 - ny * w0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // shadow
  ctx.save();
  ctx.translate(0.45, 0.75);
  ctx.globalAlpha = 0.35;
  band(0, L, "#000");
  ctx.restore();
  // cylindrical shading across the stick
  const across = (c1: string, c2: string, s: number) => {
    const [x, y] = at(s);
    const w = halfW(s);
    const g = ctx.createLinearGradient(x + nx * w, y + ny * w, x - nx * w, y - ny * w);
    g.addColorStop(0, c2);
    g.addColorStop(0.35, c1);
    g.addColorStop(1, c2);
    return g;
  };
  band(0, 0.4, across("#3b82f6", "#1e3a8a", 0.2)); // chalked tip
  band(0.4, 1.4, across("#f8f6ee", "#cfcac0", 1)); // ferrule
  band(1.4, 29, across("#ecd3a0", "#b48a52", 15)); // maple shaft
  band(29, 30, across("#e5e7eb", "#6b7280", 29.5)); // joint ring
  band(30, 40, across("#8a4b22", "#4a2410", 35)); // forearm
  band(40, 50, across("#2b2b2b", "#0a0a0a", 45)); // wrap
  for (let s = 40.5; s < 50; s += 0.9) band(s, s + 0.12, "rgba(255,255,255,0.08)");
  band(50, 56.4, across("#7a2a16", "#3a120a", 53)); // butt sleeve
  band(56.4, L, "#111"); // bumper
  if (Math.abs(sb) > 0.02 || Math.abs(sa) > 0.02) {
    // contact marker on the cue ball: where the tip will strike (top-down projection)
    ctx.beginPath();
    ctx.arc(cx + rx * lateral - dx * depth * 0.98, cy + ry * lateral - dy * depth * 0.98, 0.16, 0, Math.PI * 2);
    ctx.fillStyle = sb > 0.02 ? "#ef4444" : sb < -0.02 ? "#60a5fa" : "#f59e0b";
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = px * 0.6;
}

function RackBar({ room, color, mine }: { room: RoomState | null; color: "A" | "B"; mine: boolean }) {
  const name = color === "A" ? "Host (A)" : "Guest (B)";
  const active = !!room && room.turn === color && room.phase !== "lobby" && room.phase !== "finished";
  const g = room?.groupsAssigned ? room.groups[color] : null;
  const ids = g === "solid" ? [1, 2, 3, 4, 5, 6, 7] : g === "stripe" ? [9, 10, 11, 12, 13, 14, 15] : [];
  const left = room ? ids.filter((id) => room.balls.find((b) => b.id === id && !b.pocketed)) : [];
  const show = g && left.length === 0 ? [8] : left;
  return (
    <div
      className={`flex shrink-0 items-center gap-2 rounded-2xl border p-2 md:w-16 md:flex-col md:self-stretch md:justify-start ${
        active ? `border-emerald-400 bg-emerald-950/40 shadow-[0_0_12px_rgba(52,211,153,0.4)] ${mine ? "pfx-bar-pulse" : ""}` : "border-slate-800 bg-slate-900/60"
      }`}
    >
      <div className="text-center text-[11px] font-semibold leading-tight text-slate-200">
        {name}
        {mine ? <div className="text-cyan-300">(bạn)</div> : null}
        {active ? <div className="text-emerald-300">● lượt</div> : null}
      </div>
      {g ? (
        <>
          <div className="text-[10px] text-slate-400">{g === "solid" ? "Bi trơn" : "Bi sọc"}</div>
          <div className="flex flex-wrap gap-1 md:flex-col md:items-center">
            {show.map((id) => (
              <MiniBall key={id} id={id} />
            ))}
          </div>
        </>
      ) : (
        <div className="text-center text-[11px] italic text-slate-500">chưa chia nhóm</div>
      )}
    </div>
  );
}

function MiniBall({ id }: { id: number }) {
  const col = BALL_FILL[id] || "#ccc";
  const stripe = id >= 9;
  const bg = stripe
    ? `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.7), transparent 45%), linear-gradient(180deg, #f8f6ee 0 24%, ${col} 24% 76%, #f8f6ee 76%)`
    : `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.6), transparent 45%), ${col}`;
  return (
    <span
      title={`Bi ${id}`}
      className="relative inline-flex h-7 w-7 items-center justify-center rounded-full shadow-md ring-1 ring-black/40"
      style={{ background: bg }}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-[8px] font-bold text-black">
        {id}
      </span>
    </span>
  );
}

function ToastLayer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" aria-live="polite">
      {toasts.map((t) => {
        const red = t.kind === "lose-turn" || t.kind === "lose";
        const gold = t.kind === "win" || t.kind === "group";
        const ids = t.group === "solid" ? [1, 2, 3, 4, 5, 6, 7] : t.group === "stripe" ? [9, 10, 11, 12, 13, 14, 15] : [];
        return (
          <div
            key={t.id}
            className={`${red ? "pfx-shake" : "pfx-pop"} rounded-2xl border px-6 py-3 text-center backdrop-blur-sm ${
              red
                ? "border-rose-500/60 bg-rose-950/70 text-rose-100"
                : gold
                  ? "border-amber-400/60 bg-slate-950/70 text-amber-100"
                  : "border-emerald-400/60 bg-slate-950/70 text-emerald-100"
            }`}
          >
            <div className={`text-2xl font-extrabold tracking-wide sm:text-4xl ${t.kind === "turn" ? "pfx-glow" : ""}`}>{t.title}</div>
            {t.sub ? <div className="mt-1 text-sm sm:text-base">{t.sub}</div> : null}
            {ids.length > 0 && (
              <div className="mt-2 flex justify-center gap-1">
                {ids.map((id, i) => (
                  <span
                    key={id}
                    className={t.side === "A" ? "pfx-fly-l" : "pfx-fly-r"}
                    style={{ animationDelay: `${0.75 + i * 0.05}s` }}
                  >
                    <MiniBall id={id} />
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Deterministic PRNG so the cached wood grain / felt noise is stable. */
function prng(seed: number) {
  let v = seed >>> 0;
  return () => {
    v = (v * 1664525 + 1013904223) >>> 0;
    return v / 4294967296;
  };
}

/** Draw all static table layers once (cached offscreen). ctx is in table units. */
function drawStaticTable(ctx: CanvasRenderingContext2D, r: RoomState, M: number, CW: number, px: number, devScale: number) {
  const tw = r.table.w;
  const th = r.table.h;
  const rnd = prng(1337);
  // --- Wooden rails: base gradient, grain lines, polished highlight
  ctx.save();
  roundRect(ctx, -M, -M, tw + 2 * M, th + 2 * M, M * 0.5);
  ctx.clip();
  const wood = ctx.createLinearGradient(0, -M, 0, th + M);
  wood.addColorStop(0, "#7a4220");
  wood.addColorStop(0.08, "#5a2d13");
  wood.addColorStop(0.5, "#4a240f");
  wood.addColorStop(0.92, "#5a2d13");
  wood.addColorStop(1, "#7a4220");
  ctx.fillStyle = wood;
  ctx.fillRect(-M, -M, tw + 2 * M, th + 2 * M);
  for (let i = 0; i < 260; i++) {
    const horiz = i % 2 === 0;
    ctx.strokeStyle = `rgba(${rnd() < 0.5 ? "30,12,4" : "140,80,40"},${0.08 + rnd() * 0.12})`;
    ctx.lineWidth = px * (0.6 + rnd() * 1.6);
    ctx.beginPath();
    if (horiz) {
      const top = rnd() < 0.5;
      const y0 = top ? -M + rnd() * (M - CW) : th + CW + rnd() * (M - CW);
      const x0 = -M + rnd() * (tw + 2 * M);
      const len = 8 + rnd() * 30;
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + len / 3, y0 + (rnd() - 0.5) * 0.6, x0 + (2 * len) / 3, y0 + (rnd() - 0.5) * 0.6, x0 + len, y0 + (rnd() - 0.5) * 0.4);
    } else {
      const left = rnd() < 0.5;
      const x0 = left ? -M + rnd() * (M - CW) : tw + CW + rnd() * (M - CW);
      const y0 = -M + rnd() * (th + 2 * M);
      const len = 6 + rnd() * 18;
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + (rnd() - 0.5) * 0.6, y0 + len / 3, x0 + (rnd() - 0.5) * 0.6, y0 + (2 * len) / 3, x0 + (rnd() - 0.5) * 0.4, y0 + len);
    }
    ctx.stroke();
  }
  // polished lacquer highlight along the outer edge
  const hl = ctx.createLinearGradient(0, -M, 0, -M + M * 0.6);
  hl.addColorStop(0, "rgba(255,230,190,0.35)");
  hl.addColorStop(1, "rgba(255,230,190,0)");
  ctx.fillStyle = hl;
  ctx.fillRect(-M, -M, tw + 2 * M, M * 0.6);
  const hl2 = ctx.createLinearGradient(0, th + M, 0, th + M * 0.4);
  hl2.addColorStop(0, "rgba(0,0,0,0.35)");
  hl2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hl2;
  ctx.fillRect(-M, th + M * 0.4, tw + 2 * M, M * 0.6);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,220,170,0.3)";
  ctx.lineWidth = px * 1.5;
  roundRect(ctx, -M + px, -M + px, tw + 2 * M - 2 * px, th + 2 * M - 2 * px, M * 0.5);
  ctx.stroke();
  // inner rail edge shadow onto the cushion line
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = px * 2;
  ctx.strokeRect(-CW, -CW, tw + 2 * CW, th + 2 * CW);

  // --- Cloth: base, felt noise, lamp vignette (covers bed + cushion band + shelves)
  ctx.fillStyle = "#0f7d42";
  ctx.fillRect(-CW, -CW, tw + 2 * CW, th + 2 * CW);
  const noiseN = 128;
  const nc = document.createElement("canvas");
  nc.width = noiseN;
  nc.height = noiseN;
  const nctx = nc.getContext("2d");
  if (nctx) {
    const img = nctx.createImageData(noiseN, noiseN);
    for (let i = 0; i < noiseN * noiseN; i++) {
      const v = rnd();
      const a = Math.floor(v * 26);
      img.data[i * 4] = v > 0.5 ? 255 : 0;
      img.data[i * 4 + 1] = v > 0.5 ? 255 : 0;
      img.data[i * 4 + 2] = v > 0.5 ? 255 : 0;
      img.data[i * 4 + 3] = a;
    }
    nctx.putImageData(img, 0, 0);
    const pat = ctx.createPattern(nc, "repeat");
    if (pat) {
      pat.setTransform(new DOMMatrix().scale(1 / devScale, 1 / devScale));
      ctx.fillStyle = pat;
      ctx.fillRect(-CW, -CW, tw + 2 * CW, th + 2 * CW);
    }
  }
  const lamp = ctx.createRadialGradient(tw / 2, th / 2, th * 0.15, tw / 2, th / 2, tw * 0.62);
  lamp.addColorStop(0, "rgba(120,255,170,0.16)");
  lamp.addColorStop(0.55, "rgba(0,0,0,0)");
  lamp.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = lamp;
  ctx.fillRect(-CW, -CW, tw + 2 * CW, th + 2 * CW);

  // --- Pockets: leather liner with depth + dark hole (= server capture circle)
  for (const p of r.pockets) {
    const pr = p.r ?? r.table.pocketR;
    const lg = ctx.createRadialGradient(p.x, p.y, pr * 0.9, p.x, p.y, pr + 0.9);
    lg.addColorStop(0, "#1a0e07");
    lg.addColorStop(0.35, "#4b2c17");
    lg.addColorStop(0.7, "#6e4527");
    lg.addColorStop(1, "#2a1709");
    ctx.beginPath();
    ctx.arc(p.x, p.y, pr + 0.9, 0, Math.PI * 2);
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,215,160,0.18)";
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.arc(p.x, p.y, pr + 0.55, 0, Math.PI * 2);
    ctx.stroke();
    const g = ctx.createRadialGradient(p.x + 0.2, p.y + 0.3, pr * 0.05, p.x, p.y, pr);
    g.addColorStop(0, "#000");
    g.addColorStop(0.7, "#030303");
    g.addColorStop(0.92, "#0d0b0a");
    g.addColorStop(1, "#241a12");
    ctx.beginPath();
    ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // --- Cushions: exact collision shape with bevel shading toward the nose
  for (const poly of r.cushionPolys || []) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of poly) {
      minX = Math.min(minX, q[0]);
      minY = Math.min(minY, q[1]);
      maxX = Math.max(maxX, q[0]);
      maxY = Math.max(maxY, q[1]);
    }
    const horiz = maxX - minX > maxY - minY;
    const onTopOrLeft = horiz ? maxY <= 0.01 : maxX <= 0.01;
    let grad: CanvasGradient;
    if (horiz) grad = onTopOrLeft ? ctx.createLinearGradient(0, minY, 0, maxY) : ctx.createLinearGradient(0, maxY, 0, minY);
    else grad = onTopOrLeft ? ctx.createLinearGradient(minX, 0, maxX, 0) : ctx.createLinearGradient(maxX, 0, minX, 0);
    grad.addColorStop(0, "#07401f");
    grad.addColorStop(0.55, "#0b6334");
    grad.addColorStop(0.9, "#138a49");
    grad.addColorStop(1, "#1aa158");
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (const q of poly.slice(1)) ctx.lineTo(q[0], q[1]);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = px;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(190,255,210,0.28)";
  ctx.lineWidth = px * 1.1;
  for (const sg of r.cushions || []) {
    if (sg.x1 !== sg.x2 && sg.y1 !== sg.y2) continue;
    ctx.beginPath();
    ctx.moveTo(sg.x1, sg.y1);
    ctx.lineTo(sg.x2, sg.y2);
    ctx.stroke();
  }

  // --- Mother-of-pearl diamond sights (18, 12.5in apart, 3 11/16in behind the nose)
  const sightOff = 3.6875;
  const diamond = (x: number, y: number, horiz: boolean) => {
    const l = 0.6;
    const w = 0.26;
    ctx.beginPath();
    if (horiz) {
      ctx.moveTo(x - l, y);
      ctx.lineTo(x, y - w);
      ctx.lineTo(x + l, y);
      ctx.lineTo(x, y + w);
    } else {
      ctx.moveTo(x, y - l);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x, y + l);
      ctx.lineTo(x - w, y);
    }
    ctx.closePath();
    const pg = ctx.createLinearGradient(x - l, y - l, x + l, y + l);
    pg.addColorStop(0, "#fdfbf5");
    pg.addColorStop(0.3, "#e8f1f5");
    pg.addColorStop(0.5, "#f7e9f2");
    pg.addColorStop(0.7, "#e6f3ea");
    pg.addColorStop(1, "#d8d2c4");
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = "rgba(60,30,10,0.6)";
    ctx.lineWidth = px * 0.7;
    ctx.stroke();
  };
  const step = tw / 8;
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue;
    diamond(k * step, -sightOff, true);
    diamond(k * step, th + sightOff, true);
  }
  for (let k = 1; k < 4; k++) {
    diamond(-sightOff, k * step, false);
    diamond(tw + sightOff, k * step, false);
  }

  // --- Head string + head/foot spots (faint)
  const hx = r.table.headStringX ?? tw / 4;
  const fs = r.table.footSpot ?? { x: tw * 0.75, y: th / 2 };
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = px;
  ctx.setLineDash([px * 4, px * 4]);
  ctx.beginPath();
  ctx.moveTo(hx, 0);
  ctx.lineTo(hx, th);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (const sp of [fs, { x: hx, y: th / 2 }]) {
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 0.26, 0, Math.PI * 2);
    ctx.fill();
  }
}

function clampSpinUi(a: number, b: number): Spin {
  const m = Math.hypot(a, b);
  return m > MISCUE ? { a: (a / m) * MISCUE, b: (b / m) * MISCUE } : { a, b };
}

/** Cue-tip offset picker: small cue-ball button (bottom-right of the table) + enlarged picker. */
function SpinPicker({
  spin,
  open,
  disabled,
  onOpen,
  onClose,
  onChange,
}: {
  spin: Spin;
  open: boolean;
  disabled: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (s: Spin) => void;
}) {
  const bigRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  useEffect(() => {
    if (disabled && open) onClose();
  }, [disabled, open, onClose]);
  const BIG = 220;
  const BR = 100; // ball radius in px inside the picker
  const setFrom = (clientX: number, clientY: number) => {
    const el = bigRef.current;
    if (!el) return;
    const rc = el.getBoundingClientRect();
    const a = (clientX - (rc.left + rc.width / 2)) / BR;
    const b = -(clientY - (rc.top + rc.height / 2)) / BR;
    onChange(clampSpinUi(a, b));
  };
  const small = 46;
  return (
    <>
      <button
        type="button"
        title={disabled ? "Chưa tới lượt bạn" : "Chọn điểm chạm cơ (xoáy)"}
        disabled={disabled}
        onClick={onOpen}
        className={`absolute bottom-3 right-3 z-30 rounded-full ring-2 transition ${
          disabled ? "cursor-not-allowed opacity-40 ring-slate-600" : "ring-cyan-400 hover:scale-110"
        }`}
        style={{ width: small, height: small }}
      >
        <span
          className="relative block h-full w-full rounded-full"
          style={{ background: "radial-gradient(circle at 35% 30%, #ffffff, #e9e6dc 55%, #b9b4a6)" }}
        >
          <span
            className="absolute h-2.5 w-2.5 rounded-full bg-red-600 ring-1 ring-white"
            style={{
              left: small / 2 + spin.a * (small / 2) - 5,
              top: small / 2 - spin.b * (small / 2) - 5,
            }}
          />
        </span>
      </button>
      {open && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40" onPointerDown={onClose}>
          <div
            className="rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-slate-200 shadow-2xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-center text-xs text-amber-200">Xoáy lên</div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300">Trái</span>
              <div
                ref={bigRef}
                className="relative touch-none select-none"
                style={{ width: BIG, height: BIG }}
                onPointerDown={(e) => {
                  dragging.current = true;
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  setFrom(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => dragging.current && setFrom(e.clientX, e.clientY)}
                onPointerUp={() => (dragging.current = false)}
              >
                <svg width={BIG} height={BIG} viewBox={`0 0 ${BIG} ${BIG}`}>
                  <defs>
                    <radialGradient id="cbg" cx="38%" cy="32%" r="70%">
                      <stop offset="0%" stopColor="#ffffff" />
                      <stop offset="60%" stopColor="#ebe7dc" />
                      <stop offset="100%" stopColor="#a8a293" />
                    </radialGradient>
                  </defs>
                  <circle cx={BIG / 2} cy={BIG / 2} r={BR} fill="url(#cbg)" stroke="#333" strokeWidth={1.5} />
                  <line x1={BIG / 2 - BR} y1={BIG / 2} x2={BIG / 2 + BR} y2={BIG / 2} stroke="rgba(0,0,0,0.35)" />
                  <line x1={BIG / 2} y1={BIG / 2 - BR} x2={BIG / 2} y2={BIG / 2 + BR} stroke="rgba(0,0,0,0.35)" />
                  <circle
                    cx={BIG / 2}
                    cy={BIG / 2}
                    r={BR * MISCUE}
                    fill="none"
                    stroke="#ef4444"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                  />
                  <text x={BIG / 2 + BR * MISCUE * 0.72} y={BIG / 2 - BR * MISCUE * 0.75} fontSize={9} fill="#b91c1c">
                    giới hạn
                  </text>
                  <circle
                    cx={BIG / 2 + spin.a * BR}
                    cy={BIG / 2 - spin.b * BR}
                    r={9}
                    fill="#dc2626"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <span className="text-xs text-slate-300">Phải</span>
            </div>
            <div className="mt-1 text-center text-xs text-sky-300">Xoáy xuống</div>
            <div className="mt-2 text-center font-mono text-[11px] text-slate-400">
              ngang {spin.a >= 0 ? "+" : ""}
              {spin.a.toFixed(2)}R · dọc {spin.b >= 0 ? "+" : ""}
              {spin.b.toFixed(2)}R
            </div>
            <div className="mt-3 flex justify-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-600 px-3 py-1 text-sm hover:border-cyan-500"
                onClick={() => onChange({ a: 0, b: 0 })}
              >
                Đặt lại giữa
              </button>
              <button
                type="button"
                className="rounded-lg bg-cyan-500 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                onClick={onClose}
              >
                Xong
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
