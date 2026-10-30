const { ack } = require("./security");
/**
 * DuoPlay — 8-ball pool (bida lỗ) server module.
 * Server-authoritative 2D circle physics; client sends {angle, power}.
 */

const TURN_MS = 60_000;

/*
 * Units: inches, seconds. Geometry follows WPA 9-ft table spec:
 *  playing surface 100 x 50 in (cushion nose to nose), ball 2.25 in,
 *  corner pocket mouth 4.5 in, side pocket mouth 5 in, cushion width 2 in,
 *  18 sights spaced 12.5 in, 3 11/16 in behind the cushion nose.
 */
const TABLE_W = 100;
const TABLE_H = 50;
const BALL_R = 1.125;
const CUSHION_W = 2; // nose -> feather strip
const RAIL_W = 5.5; // total rail incl. cushion (WPA 4..7.5)
const CORNER_MOUTH = 4.5;
const SIDE_MOUTH = 5;
const CORNER_A = CORNER_MOUTH / Math.SQRT2; // jaw tip distance from corner along each cushion
const SIDE_HALF = SIDE_MOUTH / 2;
const JAW_DEPTH = CUSHION_W;

/* Physics */
const DT = 1 / 240; // substep
const FRAME_EVERY = 8; // record 30 fps keyframes
const FPS = 1 / (DT * FRAME_EVERY);
const MAX_SIM_SEC = 14;
const MAX_SHOT_SPEED = 130; // in/s (~3.2 m/s) at 100% power
const MIN_SHOT_SPEED = 4;
const ROLL_DECEL = 5; // in/s^2 constant rolling resistance
const LINEAR_DRAG = 0.06; // 1/s speed-proportional loss (cloth/air)
const STOP_SPEED = 0.6; // in/s -> ball stops
const CUSHION_RESTITUTION = 0.78;
const CUSHION_TANGENT_KEEP = 0.95;
const BALL_RESTITUTION = 0.95;
const PLAYBACK_TAIL_MS = 400;
const MAX_POWER = MAX_SHOT_SPEED;
/** Break shots may be struck much harder (real power break ≈ 8–11 m/s); needed now that
 *  sliding friction makes the rack absorb energy realistically. */
const BREAK_MAX_SPEED = 400;

/*
 * Spin model (frame: x right, y down, z INTO the table -> right-handed; "up" = -z).
 * Ball-cloth contact point r_c = (0,0,+R). Contact velocity u = v + w x r_c.
 * Sliding: friction -mu_s*g*û on v and torque r_c x F on w (I = 2/5 mR^2) => u decays at
 * 7/2 mu_s g (Dr. Dave TP 4.1), final roll velocity = v0 - 2/7 u0. Rolling: u = 0 kept, rolling
 * resistance. Vertical spin decays at SPIN_DECAY. Cue strike: w = 5v/(2R)*(a*(right x d) + b*(up x d))
 * (b = 0.4 => natural roll). Squirt: initial direction rotated toward the side opposite english.
 */
const G = 386.1; // in/s^2
const MU_SLIDE = 0.2;
/** Ball-ball friction vs relative slip speed (Alciatore fit, as used by pooltool): a + b*exp(-c*v[m/s]). */
function muBall(slipInPerSec) {
  const v = Math.abs(slipInPerSec) * 0.0254;
  return 0.009951 + 0.108 * Math.exp(-1.088 * v);
}
const MU_CUSHION = 0.2;
const SPIN_DECAY = 6; // rad/s^2, vertical-axis spin
const MISCUE_R = 0.5; // max tip offset in units of R
const SQUIRT_MAX_DEG = 1.5; // at |a| = 0.5
const COLLISION_PASSES = 6;
const KI = 5 / (2 * BALL_R * BALL_R); // w change per unit (r x J/m)

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function contactVel(b, r) {
  const wr = cross([b.wx || 0, b.wy || 0, b.wz || 0], r);
  return [b.vx + wr[0], b.vy + wr[1], wr[2]];
}
/** Apply horizontal impulse j (per unit mass) at surface point r. */
function applyImpulse(b, r, j) {
  b.vx += j[0];
  b.vy += j[1];
  const t = cross(r, [j[0], j[1], 0]);
  b.wx = (b.wx || 0) + KI * t[0];
  b.wy = (b.wy || 0) + KI * t[1];
  b.wz = (b.wz || 0) + KI * t[2];
}

/*
 * Pocket model (WPA spec + Dr. Dave TP B.15 + pooltool-style "jaws as linear
 * cushion segments with rounded points"):
 *  - each of the 6 cushions ends at the pocket POINTS (mouth measured point to point);
 *  - from each point a FACING runs into the rail at the WPA cut angle
 *    (142° corner, 104° side) measured between cushion nose and facing;
 *  - the point itself is rounded (radius JAW_TIP_R) -> circle collision;
 *  - a ball is pocketed when its centre enters the pocket DROP circle (the slate
 *    cut behind the shelf). Drawn pockets use exactly these shapes.
 */
const CORNER_ANGLE = (142 * Math.PI) / 180;
const SIDE_ANGLE = (104 * Math.PI) / 180;
const JAW_TIP_R = 0.3;
const CORNER_DROP_R = 2.3;
const SIDE_DROP_R = 2.35;
const CORNER_DROP_OFF = 0.85; // drop centre behind corner along diagonal -> shelf ≈1.2in (WPA 1..2.25)
const SIDE_DROP_OFF = SIDE_DROP_R + 0.375; // WPA side shelf 0..0.375in: slate cut 0.375in behind the mouth line

const POCKETS = [
  { x: -CORNER_DROP_OFF, y: -CORNER_DROP_OFF, r: CORNER_DROP_R, kind: "corner" },
  { x: TABLE_W / 2, y: -SIDE_DROP_OFF, r: SIDE_DROP_R, kind: "side" },
  { x: TABLE_W + CORNER_DROP_OFF, y: -CORNER_DROP_OFF, r: CORNER_DROP_R, kind: "corner" },
  { x: -CORNER_DROP_OFF, y: TABLE_H + CORNER_DROP_OFF, r: CORNER_DROP_R, kind: "corner" },
  { x: TABLE_W / 2, y: TABLE_H + SIDE_DROP_OFF, r: SIDE_DROP_R, kind: "side" },
  { x: TABLE_W + CORNER_DROP_OFF, y: TABLE_H + CORNER_DROP_OFF, r: CORNER_DROP_R, kind: "corner" },
];
const POCKET_R = CORNER_DROP_R;

/**
 * Build one cushion from point S to point E on the nose line. n = inward normal
 * (into the table). thS/thE = cut angle at each end.
 * Returns collision segments, tip circles and a drawing polygon.
 */
function buildCushion(S, E, n, thS, thE, out) {
  const L = Math.hypot(E[0] - S[0], E[1] - S[1]);
  const u = [(E[0] - S[0]) / L, (E[1] - S[1]) / L];
  const o = [-n[0], -n[1]]; // outward (into rail)
  const end = (V, dir, th) => {
    // facing direction: rotate 'dir' (nose dir away from pocket) by th toward outward
    const f = [dir[0] * Math.cos(th) + o[0] * Math.sin(th), dir[1] * Math.cos(th) + o[1] * Math.sin(th)];
    const depth = f[0] * o[0] + f[1] * o[1];
    const F = [V[0] + (f[0] * CUSHION_W) / depth, V[1] + (f[1] * CUSHION_W) / depth];
    const half = th / 2;
    const bl = Math.hypot(dir[0] + f[0], dir[1] + f[1]);
    const bis = [(dir[0] + f[0]) / bl, (dir[1] + f[1]) / bl];
    const cd = JAW_TIP_R / Math.sin(half);
    const C = [V[0] + bis[0] * cd, V[1] + bis[1] * cd];
    const td = JAW_TIP_R / Math.tan(half);
    const Tn = [V[0] + dir[0] * td, V[1] + dir[1] * td];
    const Tf = [V[0] + f[0] * td, V[1] + f[1] * td];
    // arc from Tf to Tn (short way)
    const a1 = Math.atan2(Tf[1] - C[1], Tf[0] - C[0]);
    let a2 = Math.atan2(Tn[1] - C[1], Tn[0] - C[0]);
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const arc = [];
    for (let i = 0; i <= 6; i++) {
      const ang = a1 + (da * i) / 6;
      arc.push([C[0] + Math.cos(ang) * JAW_TIP_R, C[1] + Math.sin(ang) * JAW_TIP_R]);
    }
    return { F, C, Tn, Tf, arc };
  };
  const eS = end(S, u, thS);
  const eE = end(E, [-u[0], -u[1]], thE);
  const seg = (P, Q) => out.segs.push({ x1: P[0], y1: P[1], x2: Q[0], y2: Q[1] });
  seg(eS.Tn, eE.Tn); // nose
  seg(eS.Tf, eS.F); // facings
  seg(eE.Tf, eE.F);
  out.tips.push({ x: eS.C[0], y: eS.C[1], r: JAW_TIP_R }, { x: eE.C[0], y: eE.C[1], r: JAW_TIP_R });
  const poly = [eS.F, ...eS.arc, ...eE.arc.slice().reverse(), eE.F].map((p) => [
    Math.round(p[0] * 1000) / 1000,
    Math.round(p[1] * 1000) / 1000,
  ]);
  out.polys.push(poly);
}

function buildCushions() {
  const W = TABLE_W;
  const H = TABLE_H;
  const a = CORNER_A;
  const sh = SIDE_HALF;
  const out = { segs: [], tips: [], polys: [] };
  buildCushion([a, 0], [W / 2 - sh, 0], [0, 1], CORNER_ANGLE, SIDE_ANGLE, out);
  buildCushion([W / 2 + sh, 0], [W - a, 0], [0, 1], SIDE_ANGLE, CORNER_ANGLE, out);
  buildCushion([a, H], [W / 2 - sh, H], [0, -1], CORNER_ANGLE, SIDE_ANGLE, out);
  buildCushion([W / 2 + sh, H], [W - a, H], [0, -1], SIDE_ANGLE, CORNER_ANGLE, out);
  buildCushion([0, a], [0, H - a], [1, 0], CORNER_ANGLE, CORNER_ANGLE, out);
  buildCushion([W, a], [W, H - a], [-1, 0], CORNER_ANGLE, CORNER_ANGLE, out);
  return out;
}
const CUSHION_GEOM = buildCushions();
const CUSHIONS = CUSHION_GEOM.segs;
const JAW_TIPS = CUSHION_GEOM.tips;
const CUSHION_POLYS = CUSHION_GEOM.polys;


const HEAD_STRING_X = TABLE_W / 4;
const FOOT_SPOT = { x: TABLE_W * 0.75, y: TABLE_H / 2 };

/** @type {Map<string, any>} */
const poolRooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (poolRooms.has(code)) return makeCode();
  return code;
}

function bothSeated(room) {
  return Boolean(room.hostId && room.guestId);
}

function bothReady(room) {
  return bothSeated(room) && room.hostReady && room.guestReady;
}

function seatOf(room, socketId) {
  if (socketId === room.hostId) return "host";
  if (socketId === room.guestId) return "guest";
  return null;
}

function colorOfSeat(seat) {
  return seat === "host" ? "A" : seat === "guest" ? "B" : null;
}

function seatOfColor(color) {
  return color === "A" ? "host" : color === "B" ? "guest" : null;
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnDeadline = null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.hypot(dx, dy);
}

function ballType(id) {
  if (id === 0) return "cue";
  if (id === 8) return "eight";
  if (id >= 1 && id <= 7) return "solid";
  if (id >= 9 && id <= 15) return "stripe";
  return "unknown";
}

function makeBall(id, x, y) {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    pocketed: false,
    type: ballType(id),
  };
}

/** WPA 8-ball rack: apex on foot spot, 8 in centre of row 3, back corners one solid + one stripe. Cue behind head string. */
function rackBalls() {
  const balls = [];
  balls.push(makeBall(0, HEAD_STRING_X - 4, TABLE_H / 2));
  const gap = BALL_R * 2 + 0.004;
  const rows = [
    [1],
    [10, 3],
    [4, 8, 14],
    [11, 7, 2, 13],
    [6, 15, 9, 12, 5],
  ];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowW = (row.length - 1) * gap;
    for (let i = 0; i < row.length; i++) {
      const x = FOOT_SPOT.x + r * gap * Math.cos(Math.PI / 6);
      const y = FOOT_SPOT.y - rowW / 2 + i * gap;
      balls.push(makeBall(row[i], x, y));
    }
  }
  return balls;
}

function livingBalls(room) {
  return room.balls.filter((b) => !b.pocketed);
}

function findBall(room, id) {
  return room.balls.find((b) => b.id === id) || null;
}

function allAsleep(room) {
  return livingBalls(room).every((b) => b.vx === 0 && b.vy === 0 && !(b.wx || b.wy));
}

function stopAll(room) {
  for (const b of room.balls) {
    b.vx = 0;
    b.vy = 0;
    b.wx = 0;
    b.wy = 0;
    b.wz = 0;
  }
}

function publicBalls(room) {
  return room.balls.map((b) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    pocketed: b.pocketed,
    type: b.type,
  }));
}

function groupLabel(g) {
  if (g === "solid") return "bi trơn (1–7)";
  if (g === "stripe") return "bi sọc (9–15)";
  return "chưa gán";
}

function publicRoom(room) {
  return {
    code: room.code,
    hostSeated: Boolean(room.hostId),
    guestSeated: Boolean(room.guestId),
    hostReady: room.hostReady,
    guestReady: room.guestReady,
    phase: room.phase, // lobby | playing | animating | ball_in_hand | finished
    turn: room.turn, // "A" | "B"
    winner: room.winner, // "A" | "B" | null
    endReason: room.endReason,
    groups: { A: room.groupA, B: room.groupB },
    groupsAssigned: room.groupsAssigned,
    balls: publicBalls(room),
    table: {
      w: TABLE_W,
      h: TABLE_H,
      ballR: BALL_R,
      pocketR: POCKET_R,
      cushionW: CUSHION_W,
      railW: RAIL_W,
      cornerA: CORNER_A,
      sideHalf: SIDE_HALF,
      headStringX: HEAD_STRING_X,
      footSpot: FOOT_SPOT,
    },
    cushions: CUSHIONS,
    jawTips: JAW_TIPS,
    cushionPolys: CUSHION_POLYS,
    pockets: POCKETS,
    turnDeadline: room.turnDeadline,
    turnLimitSec: TURN_MS / 1000,
    ballInHand: room.ballInHand,
    lastEvent: room.lastEvent,
    lastShotResult: room.lastShotResult || null,
    score: { A: room.scoreA, B: room.scoreB },
    isBreak: room.isBreak,
    maxPower: MAX_POWER,
  };
}

function emitRoom(io, room) {
  if (!io) return;
  io.to(room.code).emit("pool:update", publicRoom(room));
}

function emitSnapshot(io, room, extra) {
  io.to(room.code).emit("pool:snapshot", {
    balls: publicBalls(room),
    phase: room.phase,
    ...(extra || {}),
  });
}

function startTurnTimer(io, room) {
  clearTurnTimer(room);
  if (!io) return;
  if (room.phase !== "playing" && room.phase !== "ball_in_hand") return;
  if (room.winner) return;
  room.turnDeadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    onShotTimeout(io, room);
  }, TURN_MS);
  emitRoom(io, room);
}

function onShotTimeout(io, room) {
  if (room.winner) return;
  if (room.phase !== "playing" && room.phase !== "ball_in_hand") return;
  room.lastEvent = {
    type: "timeout",
    message: "Hết 60s — mất lượt",
    at: Date.now(),
  };
  // Simple foul-pass: no auto-shot, just switch turn. No ball-in-hand.
  room.ballInHand = false;
  room.phase = "playing";
  switchTurn(room);
  startTurnTimer(io, room);
  emitRoom(io, room);
}

function switchTurn(room) {
  room.turn = room.turn === "A" ? "B" : "A";
}

function resetRound(room, keepScore) {
  clearTurnTimer(room);
  room.balls = rackBalls();
  room.phase = "lobby";
  room.turn = "A";
  room.winner = null;
  room.endReason = null;
  room.groupA = null;
  room.groupB = null;
  room.groupsAssigned = false;
  room.ballInHand = false;
  room.isBreak = true;
  room.lastEvent = null;
  room.lastShotResult = null;
  room.hostReady = false;
  room.guestReady = false;
  room.simRunning = false;
  if (!keepScore) {
    room.scoreA = 0;
    room.scoreB = 0;
  }
}

function newRoom(hostId) {
  const room = {
    code: makeCode(),
    hostId,
    guestId: null,
    hostReady: false,
    guestReady: false,
    balls: rackBalls(),
    phase: "lobby",
    turn: "A",
    winner: null,
    endReason: null,
    groupA: null,
    groupB: null,
    groupsAssigned: false,
    ballInHand: false,
    isBreak: true,
    lastEvent: null,
    turnDeadline: null,
    turnTimer: null,
    scoreA: 0,
    scoreB: 0,
    simRunning: false,
  };
  return room;
}

function startGame(io, room) {
  clearTurnTimer(room);
  room.balls = rackBalls();
  room.phase = "playing";
  room.turn = "A";
  room.winner = null;
  room.endReason = null;
  room.groupA = null;
  room.groupB = null;
  room.groupsAssigned = false;
  room.ballInHand = false;
  room.isBreak = true;
  room.lastEvent = { type: "start", message: "Bắt đầu — Host phá bi", at: Date.now() };
  startTurnTimer(io, room);
  emitRoom(io, room);
}

function ownGroup(room, color) {
  return color === "A" ? room.groupA : room.groupB;
}

function remainingOfGroup(room, group) {
  if (!group) return 7;
  return room.balls.filter((b) => !b.pocketed && b.type === group).length;
}

function playerCleared(room, color) {
  const g = ownGroup(room, color);
  if (!g) return false;
  return remainingOfGroup(room, g) === 0;
}

function legalObjectTypes(room, color, pocketedThisShot = []) {
  if (!room.groupsAssigned) return ["solid", "stripe"];
  const g = ownGroup(room, color);
  if (!g) return ["solid", "stripe"];
  // remaining at the START of the shot (balls potted on this shot still count)
  const remain = room.balls.filter((b) => b.type === g && (!b.pocketed || pocketedThisShot.includes(b.id))).length;
  return remain === 0 ? ["eight"] : [g];
}

function resolveCollisions(balls, onHit) {
  const minD = BALL_R * 2;
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.pocketed) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.pocketed) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD || d2 === 0) continue;
      // Exact time of impact: rewind both balls along their velocities to the
      // moment |d| == 2R so the contact normal matches the analytic (ghost-ball) one.
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const rv2 = rvx * rvx + rvy * rvy;
      let tb = 0;
      if (rv2 > 1e-9) {
        // |d - rv*t| = minD, smallest t >= 0 (going back in time)
        const bq = dx * rvx + dy * rvy;
        const disc = bq * bq - rv2 * (d2 - minD * minD);
        if (disc >= 0) tb = Math.min(DT * 2, Math.max(0, (bq + Math.sqrt(disc)) / rv2));
      }
      a.x -= a.vx * tb;
      a.y -= a.vy * tb;
      b.x -= b.vx * tb;
      b.y -= b.vy * tb;
      let cx = b.x - a.x;
      let cy = b.y - a.y;
      let cd = Math.hypot(cx, cy) || minD;
      const nx = cx / cd;
      const ny = cy / cd;
      if (cd < minD) {
        const overlap = minD - cd;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
      }
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vn > 0) {
        const impulse = ((1 + BALL_RESTITUTION) * vn) / 2;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
        // Throw: friction between the balls along the horizontal tangent, limited by mu*Jn
        // and by the impulse that would stop relative sliding (effective factor 7).
        const ra = [nx * BALL_R, ny * BALL_R, 0];
        const rb = [-nx * BALL_R, -ny * BALL_R, 0];
        const ca = contactVel(a, ra);
        const cbv = contactVel(b, rb);
        const tx = -ny;
        const ty = nx;
        const ut = (ca[0] - cbv[0]) * tx + (ca[1] - cbv[1]) * ty;
        const jt = Math.sign(ut) * Math.min(muBall(ut) * impulse, Math.abs(ut) / 7);
        if (jt !== 0) {
          applyImpulse(a, ra, [-jt * tx, -jt * ty]);
          applyImpulse(b, rb, [jt * tx, jt * ty]);
        }
        onHit?.(a, b, vn);
      }
      // re-advance the rewound time with post-impact velocities
      a.x += a.vx * tb;
      a.y += a.vy * tb;
      b.x += b.vx * tb;
      b.y += b.vy * tb;
    }
  }
}

/**
 * Cushion impact (simplified Han 2005-style impulse): normal restitution e, plus a friction
 * impulse along the rail at the ball-cushion contact (-n R) limited by mu_c*(1+e)|vn| or by
 * sticking (factor 7/2). Side spin (wz) therefore changes the rebound angle and speed.
 */
function cushionResponse(b, nx, ny, vn, e) {
  // vn < 0 (approaching). Normal impulse:
  const jn = -(1 + e) * vn;
  b.vx += jn * nx;
  b.vy += jn * ny;
  const r = [-nx * BALL_R, -ny * BALL_R, 0];
  const c = contactVel(b, r);
  const tx = -ny;
  const ty = nx;
  const ut = c[0] * tx + c[1] * ty;
  const jt = Math.sign(ut) * Math.min(MU_CUSHION * jn, Math.abs(ut) / 3.5);
  if (jt !== 0) applyImpulse(b, r, [-jt * tx, -jt * ty]);
}

function bounceCushions(b, onCushion) {
  if (b.pocketed) return;
  for (const s of CUSHIONS) {
    const ex = s.x2 - s.x1;
    const ey = s.y2 - s.y1;
    const len2 = ex * ex + ey * ey;
    let t = ((b.x - s.x1) * ex + (b.y - s.y1) * ey) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = s.x1 + ex * t;
    const cy = s.y1 + ey * t;
    const dx = b.x - cx;
    const dy = b.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= BALL_R * BALL_R || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    b.x = cx + nx * BALL_R;
    b.y = cy + ny * BALL_R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) continue;
    cushionResponse(b, nx, ny, vn, CUSHION_RESTITUTION);
    onCushion?.(b, -vn);
  }
  for (const t of JAW_TIPS) {
    const dx = b.x - t.x;
    const dy = b.y - t.y;
    const rr = BALL_R + t.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    b.x = t.x + nx * rr;
    b.y = t.y + ny * rr;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) continue;
    // pocket points are hard facings: a bit livelier rattle
    cushionResponse(b, nx, ny, vn, 0.7);
    onCushion?.(b, -vn);
  }
}

function checkPockets(b, pocketedThisShot, onPocket) {
  if (b.pocketed) return;
  let target = null;
  for (let k = 0; k < POCKETS.length; k++) {
    const p = POCKETS[k];
    if (dist(b.x, b.y, p.x, p.y) < p.r) {
      target = k;
      break;
    }
  }
  // Safety: escaped past the cushion line => nearest pocket
  if (target == null && (b.x < -CUSHION_W || b.x > TABLE_W + CUSHION_W || b.y < -CUSHION_W || b.y > TABLE_H + CUSHION_W)) {
    let best = Infinity;
    POCKETS.forEach((p, k) => {
      const dd = dist(b.x, b.y, p.x, p.y);
      if (dd < best) {
        best = dd;
        target = k;
      }
    });
  }
  if (target == null) return;
  const p = POCKETS[target];
  b.pocketed = true;
  b.vx = 0;
  b.vy = 0;
  b.wx = 0;
  b.wy = 0;
  b.wz = 0;
  b.x = p.x;
  b.y = p.y;
  pocketedThisShot.push(b.id);
  onPocket?.(b, target);
}

function integrateBall(b) {
  const R = BALL_R;
  b.wx = b.wx || 0;
  b.wy = b.wy || 0;
  b.wz = b.wz || 0;
  // vertical spin decay
  if (b.wz !== 0) {
    const dz = SPIN_DECAY * DT;
    b.wz = Math.abs(b.wz) <= dz ? 0 : b.wz - Math.sign(b.wz) * dz;
  }
  // contact point velocity with cloth (r_c = (0,0,R)): w x r_c = (wy R, -wx R, 0)
  const ux = b.vx + b.wy * R;
  const uy = b.vy - b.wx * R;
  const us = Math.hypot(ux, uy);
  const sp = Math.hypot(b.vx, b.vy);
  if (us > 1e-3) {
    // sliding
    const du = 3.5 * MU_SLIDE * G * DT;
    if (us <= du) {
      // reaches pure roll this step: v_f = v - 2/7 u
      b.vx -= (2 / 7) * ux;
      b.vy -= (2 / 7) * uy;
      b.wx = b.vy / R;
      b.wy = -b.vx / R;
    } else {
      const fx = (-MU_SLIDE * G * ux) / us;
      const fy = (-MU_SLIDE * G * uy) / us;
      b.vx += fx * DT;
      b.vy += fy * DT;
      // torque r_c x F = (0,0,R) x (fx,fy,0) = (-R fy, R fx, 0)
      b.wx += KI * (-R * fy) * DT;
      b.wy += KI * (R * fx) * DT;
    }
  } else if (sp > 0) {
    const ns = sp - (ROLL_DECEL + LINEAR_DRAG * sp) * DT;
    if (ns <= STOP_SPEED) {
      b.vx = 0;
      b.vy = 0;
      b.wx = 0;
      b.wy = 0;
    } else {
      b.vx *= ns / sp;
      b.vy *= ns / sp;
      b.wx = b.vy / R;
      b.wy = -b.vx / R;
    }
  } else {
    b.wx = 0;
    b.wy = 0;
  }
  b.x += b.vx * DT;
  b.y += b.vy * DT;
}

function stepPhysics(room, firstHitRef, pocketedThisShot, hooks) {
  const balls = room.balls;
  for (const b of balls) {
    if (b.pocketed) continue;
    integrateBall(b);
  }
  // Several passes so impulses propagate through frozen clusters (the rack) in one step.
  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    let any = false;
    resolveCollisions(balls, (a, b, vn) => {
      any = true;
      if (firstHitRef.id == null) {
        if (a.id === 0) firstHitRef.id = b.id;
        else if (b.id === 0) firstHitRef.id = a.id;
      }
      hooks?.onHit?.(a, b, vn);
    });
    if (!any) break;
  }
  for (const b of balls) {
    bounceCushions(b, hooks?.onCushion);
    checkPockets(b, pocketedThisShot, hooks?.onPocket);
  }
}

/**
 * Simulate a full shot deterministically. Mutates room.balls to final state.
 * Returns keyframes (30 fps, positions quantised to 0.01 in) + events.
 */
function simulateShot(room) {
  const firstHitRef = { id: null };
  let railAfterContact = false;
  /** @type {number[]} */
  const pocketedThisShot = [];
  const ids = room.balls.map((b) => b.id);
  /** @type {(number[]|null)[]} frames: flat [x0,y0,x1,y1,...]; pocketed balls stay at pocket */
  const frames = [];
  const events = [];
  const snap = () => {
    const f = [];
    for (const b of room.balls)
      f.push(
        Math.round(b.x * 100),
        Math.round(b.y * 100),
        b.pocketed ? 1 : 0,
        b.pocketed ? 0 : Math.round((b.wx || 0) * 10),
        b.pocketed ? 0 : Math.round((b.wy || 0) * 10),
        b.pocketed ? 0 : Math.round((b.wz || 0) * 10),
      );
    frames.push(f);
  };
  const hooks = {
    onPocket: (b, k) => events.push({ f: frames.length, type: "pocket", id: b.id, pocket: k }),
    onHit: (a, b, vn) => {
      if (vn > 3) events.push({ f: frames.length, type: "hit", v: Math.round(vn) });
    },
    onCushion: (b, vn) => {
      if (firstHitRef.id != null) railAfterContact = true;
      if (vn > 5) events.push({ f: frames.length, type: "cushion", v: Math.round(vn) });
    },
  };
  snap();
  const maxSteps = Math.round(MAX_SIM_SEC / DT);
  let steps = 0;
  while (steps < maxSteps) {
    stepPhysics(room, firstHitRef, pocketedThisShot, hooks);
    steps += 1;
    if (steps % FRAME_EVERY === 0) snap();
    if (allAsleep(room)) break;
  }
  if (steps % FRAME_EVERY !== 0) snap();
  stopAll(room);
  return {
    ids,
    stride: 6,
    fps: FPS,
    frames,
    events,
    durationSec: steps * DT,
    firstHitId: firstHitRef.id,
    railAfterContact,
    pocketed: [...new Set(pocketedThisShot)],
  };
}

function finishShot(io, room, firstHitId, pocketedIds, railAfterContact = true) {
  const shooter = room.turn;
  const hadGroups = room.groupsAssigned;
  room.shotSeq = (room.shotSeq || 0) + 1;
  // Compute outcome without emitting, then publish a summary for client animations.
  finishShotInner(null, room, firstHitId, pocketedIds, railAfterContact);
  const ev = room.lastEvent || {};
  room.lastShotResult = {
    seq: room.shotSeq,
    shooter,
    nextTurn: room.turn,
    keptTurn: !room.winner && room.turn === shooter,
    foul: ev.type === "foul",
    reason: ev.type === "foul" ? ev.message : null,
    ballInHand: Boolean(room.ballInHand),
    assignedGroups: !hadGroups && room.groupsAssigned ? { A: room.groupA, B: room.groupB } : null,
    winner: room.winner || null,
    endReason: room.endReason || null,
  };
  if (io) {
    startTurnTimer(io, room);
    emitRoom(io, room);
  }
}

function finishShotInner(io, room, firstHitId, pocketedIds, railAfterContact = true) {
  stopAll(room);
  const color = room.turn; // shooter
  const cuePocketed = pocketedIds.includes(0);
  const eightPocketed = pocketedIds.includes(8);
  const objectPocketed = pocketedIds.filter((id) => id !== 0 && id !== 8);
  const firstHit = firstHitId != null ? findBall(room, firstHitId) : null;
  const wasBreak = room.isBreak;

  let foul = false;
  let foulMsg = null;
  let continueTurn = false;
  let end = null; // { winner, reason, message }

  // Scratch
  if (cuePocketed) {
    foul = true;
    foulMsg = "Bi cái rơi lỗ";
    const cue = findBall(room, 0);
    if (cue) {
      cue.pocketed = false;
      cue.x = HEAD_STRING_X - 4;
      cue.y = TABLE_H / 2;
      cue.vx = 0;
      cue.vy = 0;
      placeCueFree(room, cue);
    }
  }

  // No contact at all (break included)
  if (!foul && firstHitId == null) {
    foul = true;
    foulMsg = "Không chạm bi nào";
  }

  // Wrong first ball. Group of the shooter is judged BEFORE this shot's pockets.
  if (!foul && firstHit) {
    if (!room.groupsAssigned) {
      if (firstHit.type === "eight" && !wasBreak) {
        foul = true;
        foulMsg = "Bàn mở: không được chạm bi 8 đầu tiên";
      }
    } else {
      const legal = legalObjectTypes(room, color, pocketedIds);
      if (!legal.includes(firstHit.type)) {
        foul = true;
        foulMsg = firstHit.type === "eight" ? "Chạm bi 8 quá sớm" : "Chạm sai nhóm bi";
      }
    }
  }

  // After legal contact: something must be pocketed or a ball must reach a rail
  if (!foul && !wasBreak && pocketedIds.length === 0 && !railAfterContact) {
    foul = true;
    foulMsg = "Không có bi nào chạm băng sau va chạm";
  }

  // Eight pocketed
  if (eightPocketed) {
    const g = ownGroup(room, color);
    // must have cleared the group BEFORE this shot (potting last group ball + 8 together = loss)
    const remainOwn = g
      ? room.balls.filter((b) => b.type === g && (!b.pocketed || pocketedIds.includes(b.id))).length
      : 99;
    const legallyCleared = room.groupsAssigned && remainOwn === 0;

    if (!room.groupsAssigned || !legallyCleared) {
      end = {
        winner: color === "A" ? "B" : "A",
        reason: "eight-early",
        message: "Bi 8 vào sớm — thua",
      };
    } else if (foul || cuePocketed) {
      end = {
        winner: color === "A" ? "B" : "A",
        reason: "eight-scratch",
        message: "Bi 8 vào lỗ nhưng phạm quy — thua",
      };
    } else {
      end = {
        winner: color,
        reason: "eight",
        message: "Bi 8 vào lỗ — thắng!",
      };
    }
  }

  // Assign groups on first legal object pocket (not on foul scratch of only cue)
  if (!end && !foul && !wasBreak && !room.groupsAssigned && objectPocketed.length > 0) {
    const firstObj = objectPocketed[0];
    const t = ballType(firstObj);
    if (t === "solid" || t === "stripe") {
      const types = new Set(objectPocketed.map(ballType));
      if (!(types.has("solid") && types.has("stripe"))) {
        if (color === "A") {
          room.groupA = t;
          room.groupB = t === "solid" ? "stripe" : "solid";
        } else {
          room.groupB = t;
          room.groupA = t === "solid" ? "stripe" : "solid";
        }
        room.groupsAssigned = true;
        room.lastEvent = {
          type: "assign",
          message: `Nhóm: A=${groupLabel(room.groupA)}, B=${groupLabel(room.groupB)}`,
          at: Date.now(),
        };
      }
    }
  }

  // Continue turn if pocketed own (or any object before assign) and no foul
  if (!end && !foul) {
    if (!room.groupsAssigned) {
      continueTurn = objectPocketed.length > 0;
    } else {
      const g = ownGroup(room, color);
      continueTurn = objectPocketed.some((id) => ballType(id) === g);
    }
  }

  room.isBreak = false;

  if (end) {
    room.phase = "finished";
    room.winner = end.winner;
    room.endReason = end.reason;
    room.ballInHand = false;
    clearTurnTimer(room);
    if (end.winner === "A") room.scoreA += 1;
    else if (end.winner === "B") room.scoreB += 1;
    room.lastEvent = { type: "end", message: end.message, at: Date.now() };
    emitRoom(io, room);
    return;
  }

  if (foul) {
    room.lastEvent = {
      type: "foul",
      message: foulMsg || "Phạm quy",
      at: Date.now(),
    };
    room.ballInHand = true; // cue ball movable until the first cue pull / shot
    room.cueLocked = false;
    switchTurn(room);
    room.phase = "playing";
    startTurnTimer(io, room);
    emitRoom(io, room);
    return;
  }

  if (continueTurn) {
    room.lastEvent = {
      type: "continue",
      message: "Vào bi — tiếp tục lượt",
      at: Date.now(),
    };
    room.phase = "playing";
    room.ballInHand = false;
    startTurnTimer(io, room);
    emitRoom(io, room);
    return;
  }

  room.lastEvent = {
    type: "miss",
    message: "Đổi lượt",
    at: Date.now(),
  };
  switchTurn(room);
  room.phase = "playing";
  room.ballInHand = false;
  startTurnTimer(io, room);
  emitRoom(io, room);
}

function placeCueFree(room, cue) {
  // Try head spot then spiral
  const spots = [
    [HEAD_STRING_X - 4, TABLE_H / 2],
    [HEAD_STRING_X - 8, TABLE_H / 2],
    [HEAD_STRING_X, TABLE_H / 2],
    [HEAD_STRING_X - 4, TABLE_H / 2 - 6],
    [HEAD_STRING_X - 4, TABLE_H / 2 + 6],
  ];
  for (const [x, y] of spots) {
    cue.x = x;
    cue.y = y;
    if (!overlapsAny(room, cue)) return;
  }
  for (let t = 0; t < 40; t++) {
    cue.x = BALL_R + 2 + Math.random() * (TABLE_W - 2 * BALL_R - 4);
    cue.y = BALL_R + 2 + Math.random() * (TABLE_H - 2 * BALL_R - 4);
    if (!overlapsAny(room, cue) && !nearPocket(cue.x, cue.y)) return;
  }
}

function nearPocket(x, y) {
  return POCKETS.some((p) => dist(x, y, p.x, p.y) < POCKET_R + BALL_R);
}

function overlapsAny(room, cue) {
  for (const b of room.balls) {
    if (b.id === 0 || b.pocketed) continue;
    if (dist(cue.x, cue.y, b.x, b.y) < BALL_R * 2 + 0.2) return true;
  }
  return false;
}

function isValidCuePlacement(room, x, y) {
  if (x < BALL_R || x > TABLE_W - BALL_R || y < BALL_R || y > TABLE_H - BALL_R) return false;
  if (nearPocket(x, y)) return false;
  const cue = { id: 0, x, y };
  return !overlapsAny(room, cue);
}

function runSimulation(io, room) {
  room.simRunning = true;
  room.phase = "animating";
  clearTurnTimer(room);
  const shotId = (room.shotId || 0) + 1;
  room.shotId = shotId;
  const result = simulateShot(room);
  const playMs = Math.round(result.durationSec * 1000) + PLAYBACK_TAIL_MS;
  // Send the trajectory first so clients never flash the final positions.
  io.to(room.code).emit("pool:shot", {
    shotId,
    ids: result.ids,
    stride: result.stride,
    fps: result.fps,
    frames: result.frames,
    events: result.events,
    durationMs: playMs,
  });
  emitRoom(io, room);
  // Keep the room in "animating" while clients play the shot back in real time.
  room.playbackTimer = setTimeout(() => {
    room.playbackTimer = null;
    if (!room.simRunning || room.shotId !== shotId) return;
    room.simRunning = false;
    finishShot(io, room, result.firstHitId, result.pocketed, result.railAfterContact);
  }, playMs);
}

function clampSpin(spin) {
  let sa = Number(spin?.a) || 0;
  let sb = Number(spin?.b) || 0;
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return { a: 0, b: 0 };
  const m = Math.hypot(sa, sb);
  if (m > MISCUE_R) {
    sa = (sa / m) * MISCUE_R;
    sb = (sb / m) * MISCUE_R;
  }
  return { a: sa, b: sb };
}

/** Cue strike. spin.a = side offset (+ right), spin.b = vertical offset (+ above centre), units of R. */
function applyShot(room, angle, power, spin) {
  const cue = findBall(room, 0);
  if (!cue || cue.pocketed) return false;
  const pw = clamp(Number(power), 0, 1);
  const a0 = Number(angle);
  if (!Number.isFinite(a0) || !Number.isFinite(pw)) return false;
  const { a, b } = clampSpin(spin);
  const maxSp = room.isBreak ? BREAK_MAX_SPEED : MAX_SHOT_SPEED;
  const sp = MIN_SHOT_SPEED + (maxSp - MIN_SHOT_SPEED) * pw;
  // Squirt: CB deflects away from the english side (right english -> left).
  const squirt = ((SQUIRT_MAX_DEG * Math.PI) / 180) * (a / MISCUE_R);
  const ang = a0 - squirt;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  cue.vx = dx * sp;
  cue.vy = dy * sp;
  // w = 5v/(2R) * (a*(right x d) + b*(up x d)); right = (-dy,dx,0), up = (0,0,-1)
  // right x d = (0,0,-1); up x d = (dy,-dx,0)
  const k = (5 * sp) / (2 * BALL_R);
  cue.wx = k * b * dy;
  cue.wy = k * b * -dx;
  cue.wz = k * a * -1;
  return true;
}

/**
 * @param {import("socket.io").Server} io
 */
function registerPool(io) {
  io.on("connection", (socket) => {
    socket.on("pool:create", (payload, cb) => {
      let callback = typeof payload === "function" ? payload : cb;
      const room = newRoom(socket.id);
      poolRooms.set(room.code, room);
      socket.join(room.code);
      socket.data.poolCode = room.code;
      socket.data.poolSeat = "host";
      ack(callback)({ ok: true, seat: "host", color: "A", room: publicRoom(room) });
    });

    socket.on("pool:join", (code, cb) => {
      const normalized = String(code || "").trim().toUpperCase();
      const room = poolRooms.get(normalized);
      if (!room) {
        ack(cb)({ ok: false, error: "Không tìm thấy phòng." });
        return;
      }
      if (room.hostId === socket.id) {
        socket.join(normalized);
        socket.data.poolCode = normalized;
        socket.data.poolSeat = "host";
        ack(cb)({ ok: true, seat: "host", color: "A", room: publicRoom(room) });
        return;
      }
      if (room.guestId === socket.id) {
        socket.join(normalized);
        socket.data.poolCode = normalized;
        socket.data.poolSeat = "guest";
        ack(cb)({ ok: true, seat: "guest", color: "B", room: publicRoom(room) });
        return;
      }
      if (!room.hostId) {
        room.hostId = socket.id;
        room.hostReady = false;
        socket.join(normalized);
        socket.data.poolCode = normalized;
        socket.data.poolSeat = "host";
        clearTurnTimer(room);
        if (room.phase !== "finished") room.phase = "lobby";
        ack(cb)({ ok: true, seat: "host", color: "A", room: publicRoom(room) });
        emitRoom(io, room);
        return;
      }
      if (room.guestId && room.guestId !== socket.id) {
        ack(cb)({ ok: false, error: "Phòng đã đủ 2 người." });
        return;
      }
      room.guestId = socket.id;
      room.guestReady = false;
      socket.join(normalized);
      socket.data.poolCode = normalized;
      socket.data.poolSeat = "guest";
      if (room.phase === "playing" || room.phase === "animating" || room.phase === "ball_in_hand") {
        // Don't yank mid-game harshly — keep state but require rematch if someone rejoins mid? Keep as is.
      }
      ack(cb)({ ok: true, seat: "guest", color: "B", room: publicRoom(room) });
      emitRoom(io, room);
    });

    socket.on("pool:state", (cb) => {
      const code = socket.data.poolCode;
      const room = code ? poolRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = seatOf(room, socket.id);
      ack(cb)({
        ok: true,
        seat,
        color: colorOfSeat(seat),
        room: publicRoom(room),
      });
    });

    socket.on("pool:ready", (ready, cb) => {
      const code = socket.data.poolCode;
      const room = code ? poolRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (room.phase === "finished") {
        ack(cb)({ ok: false, error: "Ván đã kết thúc. Hãy chơi lại." });
        return;
      }
      if (room.phase === "playing" || room.phase === "animating" || room.phase === "ball_in_hand") {
        ack(cb)({ ok: false, error: "Đang trong ván." });
        return;
      }
      const seat = seatOf(room, socket.id);
      if (!seat) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (seat === "host") room.hostReady = Boolean(ready);
      else room.guestReady = Boolean(ready);

      if (bothReady(room)) {
        startGame(io, room);
      } else {
        emitRoom(io, room);
      }
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("pool:aim-preview", () => {
      // Legacy; kept for forward-compat.
    });

    // Live cue/aim relay so the opponent sees the cue being drawn back.
    socket.on("pool:aim", (payload) => {
      const code = socket.data.poolCode;
      const room = code ? poolRooms.get(code) : null;
      if (!room || room.phase !== "playing") return;
      const color = colorOfSeat(seatOf(room, socket.id));
      if (!color || color !== room.turn) return;
      const angle = Number(payload?.angle);
      const power = clamp(Number(payload?.power) || 0, 0, 1);
      const active = Boolean(payload?.active);
      if (!Number.isFinite(angle)) return;
      if (active && power > 0) room.cueLocked = true;
      const sp = clampSpin(payload?.spin);
      socket.to(code).emit("pool:aim", { angle, power, active, spin: sp });
    });

    // Live relay of the cue ball being dragged during ball-in-hand (client throttles ~20 Hz).
    socket.on("pool:place-move", (payload) => {
      const code = socket.data.poolCode;
      const room = code ? poolRooms.get(code) : null;
      if (!room || !room.ballInHand || room.cueLocked) return;
      const color = colorOfSeat(seatOf(room, socket.id));
      if (!color || color !== room.turn) return;
      const x = Number(payload?.x);
      const y = Number(payload?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      socket.to(code).emit("pool:place-move", { x, y, valid: isValidCuePlacement(room, x, y), active: Boolean(payload?.active) });
    });

    socket.on("pool:place-cue", (payload, cb) => {
      const { x, y } = payload && typeof payload === "object" ? payload : {};
      const code = socket.data.poolCode;
      const room = code ? poolRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = seatOf(room, socket.id);
      const color = colorOfSeat(seat);
      if (!color || color !== room.turn) {
        ack(cb)({ ok: false, error: "Chưa tới lượt bạn." });
        return;
      }
      if ((room.phase !== "ball_in_hand" && room.phase !== "playing") || !room.ballInHand || room.cueLocked) {
        ack(cb)({ ok: false, error: "Không được đặt bi chủ lúc này." });
        return;
      }
      if (room.simRunning) {
        ack(cb)({ ok: false, error: "Đang mô phỏng." });
        return;
      }
      const px = Number(x);
      const py = Number(y);
      if (!isValidCuePlacement(room, px, py)) {
        ack(cb)({ ok: false, error: "Vị trí không hợp lệ." });
        return;
      }
      const cue = findBall(room, 0);
      if (!cue) {
        ack(cb)({ ok: false, error: "Không có bi chủ." });
        return;
      }
      cue.x = px;
      cue.y = py;
      cue.pocketed = false;
      cue.vx = 0;
      cue.vy = 0;
      room.phase = "playing"; // still ballInHand: may re-place until a cue pull starts
      room.lastEvent = { type: "place", message: "Đã đặt bi chủ", at: Date.now() };
      // Keep same turn timer running
      emitRoom(io, room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("pool:shoot", (payload, cb) => {
      const { angle, power, spin } = payload && typeof payload === "object" ? payload : {};
      const code = socket.data.poolCode;
      const room = code ? poolRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = seatOf(room, socket.id);
      const color = colorOfSeat(seat);
      if (!color || color !== room.turn) {
        ack(cb)({ ok: false, error: "Chưa tới lượt bạn." });
        return;
      }
      if (room.phase === "ball_in_hand") {
        ack(cb)({ ok: false, error: "Hãy đặt bi chủ trước." });
        return;
      }
      if (room.phase !== "playing") {
        ack(cb)({ ok: false, error: "Chưa đến lúc bắn." });
        return;
      }
      if (room.simRunning || room.winner) {
        ack(cb)({ ok: false, error: "Không thể bắn lúc này." });
        return;
      }
      if (!bothReady(room) && room.phase === "lobby") {
        ack(cb)({ ok: false, error: "Chưa sẵn sàng." });
        return;
      }
      const ok = applyShot(room, angle, power, spin);
      if (ok) {
        room.ballInHand = false;
        room.cueLocked = false;
      }
      if (!ok) {
        ack(cb)({ ok: false, error: "Góc/lực không hợp lệ." });
        return;
      }
      ack(cb)({ ok: true });
      runSimulation(io, room);
    });

    socket.on("pool:rematch", (_payload, cb) => {
      let callback = typeof _payload === "function" ? _payload : cb;
      const code = socket.data.poolCode;
      const room = code ? poolRooms.get(code) : null;
      if (!room) {
        ack(callback)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      resetRound(room, true);
      emitRoom(io, room);
      ack(callback)({ ok: true, room: publicRoom(room) });
    });

    socket.on("pool:react", (emoji, cb) => {
      const code = socket.data.poolCode;
      const room = code ? poolRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = seatOf(room, socket.id);
      if (!seat) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      const allowed = ["thumbsup", "laugh", "wow", "fire", "cry", "party", "clap", "heart"];
      if (!allowed.includes(emoji)) {
        ack(cb)({ ok: false, error: "Emoji không hợp lệ." });
        return;
      }
      io.to(code).emit("pool:reaction", {
        emoji,
        seat,
        color: colorOfSeat(seat),
        at: Date.now(),
      });
      ack(cb)({ ok: true });
    });

    socket.on("disconnect", () => {
      const code = socket.data.poolCode;
      if (!code) return;
      const room = poolRooms.get(code);
      if (!room) return;
      if (room.hostId === socket.id) {
        room.hostId = null;
        room.hostReady = false;
      }
      if (room.guestId === socket.id) {
        room.guestId = null;
        room.guestReady = false;
      }
      room.scoreA = 0;
      room.scoreB = 0;
      room.simRunning = false;
      clearTurnTimer(room);
      if (room.phase !== "lobby" && room.phase !== "finished") {
        room.phase = "lobby";
        room.winner = null;
        room.endReason = null;
        room.balls = rackBalls();
        room.groupsAssigned = false;
        room.groupA = null;
        room.groupB = null;
        room.ballInHand = false;
        room.isBreak = true;
      }
      if (!room.hostId && !room.guestId) {
        poolRooms.delete(code);
      } else {
        io.to(code).emit("pool:peer-left", { seat: socket.data.poolSeat });
        emitRoom(io, room);
      }
    });
  });
}

module.exports = {
  registerPool,
  rooms: poolRooms,
  TABLE_W,
  TABLE_H,
  BALL_R,
  POCKETS,
  CUSHIONS,
  MAX_SHOT_SPEED,
  _test: { clampSpin, BALL_R, isValidCuePlacement, rackBalls, simulateShot, applyShot, newRoom, finishShot, legalObjectTypes, POCKETS, CUSHIONS, JAW_TIPS, CUSHION_POLYS },
};
