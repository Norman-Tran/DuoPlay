/**
 * Go (Cờ vây) — 2 players.
 * Rules chosen: Chinese-style AREA scoring (stones on board + surrounded empty points), komi 7.5,
 * positional superko (a move may not recreate any earlier whole-board position; covers simple ko),
 * suicide illegal, two consecutive passes -> dead-stone marking phase where both players toggle
 * dead groups and must both accept; then automatic area scoring. Resign at any time.
 * Optional clock: main time + Japanese byo-yomi (N periods of S seconds).
 */
const { createRoomKit } = require("./room-kit");

const SIZES = [9, 13, 19];
const KOMI = 7.5;
const CLOCKS = {
  none: null,
  "5m+30x3": { mainMs: 300_000, periodMs: 30_000, periods: 3, label: "5 phút + 3×30s" },
  "10m+30x3": { mainMs: 600_000, periodMs: 30_000, periods: 3, label: "10 phút + 3×30s" },
  "20m+30x5": { mainMs: 1_200_000, periodMs: 30_000, periods: 5, label: "20 phút + 5×30s" },
};
const EMPTY = 0, B = 1, W = 2;
const opp = (c) => (c === B ? W : B);
const colorName = (c) => (c === B ? "black" : "white");

function neighbors(size, i) {
  const x = i % size, y = (i / size) | 0, out = [];
  if (x > 0) out.push(i - 1);
  if (x < size - 1) out.push(i + 1);
  if (y > 0) out.push(i - size);
  if (y < size - 1) out.push(i + size);
  return out;
}

/** Group containing i and its liberty count. */
function group(board, size, i) {
  const c = board[i];
  const stones = [i], seen = new Set([i]), libs = new Set();
  for (let k = 0; k < stones.length; k++) {
    for (const n of neighbors(size, stones[k])) {
      if (board[n] === EMPTY) libs.add(n);
      else if (board[n] === c && !seen.has(n)) { seen.add(n); stones.push(n); }
    }
  }
  return { stones, libs: libs.size };
}

/**
 * Try a move. Returns {ok, board, captured:[idx]} or {ok:false, error}.
 * `history` is a Set of previous board keys (positional superko).
 */
function tryMove(board, size, i, color, history) {
  if (i < 0 || i >= size * size) return { ok: false, error: "Ngoài bàn." };
  if (board[i] !== EMPTY) return { ok: false, error: "Điểm đã có quân." };
  const nb = board.slice();
  nb[i] = color;
  const captured = [];
  for (const n of neighbors(size, i)) {
    if (nb[n] === opp(color)) {
      const g = group(nb, size, n);
      if (g.libs === 0) for (const s of g.stones) { if (nb[s] !== EMPTY) { nb[s] = EMPTY; captured.push(s); } }
    }
  }
  if (group(nb, size, i).libs === 0) return { ok: false, error: "Nước tự sát không hợp lệ." };
  if (history && history.has(nb.join(""))) return { ok: false, error: "Phạm luật Ko (lặp lại thế cờ)." };
  return { ok: true, board: nb, captured };
}

/** Area score. `dead` = Set of indices treated as removed (count for the opponent's area). */
function scoreArea(board, size, dead, komi = KOMI) {
  const b = board.map((c, i) => (dead && dead.has(i) ? EMPTY : c));
  const owner = Array(b.length).fill(0); // 1 black area, 2 white area, 0 neutral (dame)
  let black = 0, white = 0;
  const seen = new Set();
  for (let i = 0; i < b.length; i++) {
    if (b[i] === B) { black++; owner[i] = B; continue; }
    if (b[i] === W) { white++; owner[i] = W; continue; }
    if (seen.has(i)) continue;
    const region = [i]; seen.add(i);
    let touchB = false, touchW = false;
    for (let k = 0; k < region.length; k++) {
      for (const n of neighbors(size, region[k])) {
        if (b[n] === EMPTY) { if (!seen.has(n)) { seen.add(n); region.push(n); } }
        else if (b[n] === B) touchB = true;
        else touchW = true;
      }
    }
    const o = touchB && !touchW ? B : touchW && !touchB ? W : 0;
    for (const r of region) owner[r] = o;
    if (o === B) black += region.length;
    else if (o === W) white += region.length;
  }
  const whiteTotal = white + komi;
  return {
    black, white: whiteTotal, komi, owner,
    winner: black > whiteTotal ? "black" : "white",
    margin: Math.abs(black - whiteTotal),
  };
}

function newGame(room, opts, rematch) {
  const size = SIZES.includes(Number(opts && opts.size)) ? Number(opts.size) : 19;
  const clockKey = opts && CLOCKS[opts.clock] !== undefined ? opts.clock : "none";
  const prevBlack = room.game ? room.game.blackSeat : "guest";
  const blackSeat = rematch ? (prevBlack === "host" ? "guest" : "host") : "host";
  if (room.game && room.game.timer) clearTimeout(room.game.timer);
  const cfg = CLOCKS[clockKey];
  room.game = {
    size, komi: KOMI, clockKey, blackSeat,
    board: Array(size * size).fill(EMPTY),
    moveNo: Array(size * size).fill(0),
    history: new Set([Array(size * size).fill(EMPTY).join("")]),
    turn: B, moves: 0, passes: 0, lastMove: null, lastCaptured: [],
    captures: { black: 0, white: 0 },
    phase: "play", dead: new Set(), accepted: { black: false, white: false },
    result: null,
    clock: cfg ? { black: { main: cfg.mainMs, periods: cfg.periods }, white: { main: cfg.mainMs, periods: cfg.periods } } : null,
    turnStart: null, timer: null,
  };
}

const seatColor = (G, seat) => (seat === G.blackSeat ? B : W);
const colorSeat = (G, c) => (c === B ? G.blackSeat : G.blackSeat === "host" ? "guest" : "host");

function finish(room, result) {
  const G = room.game;
  G.phase = "over";
  G.result = result;
  if (G.timer) { clearTimeout(G.timer); G.timer = null; }
  G.turnStart = null;
  const seat = colorSeat(G, result.winner === "black" ? B : W);
  room.score[seat] += 1;
}

/** Charge elapsed time to the side to move. Returns false if flagged. */
function charge(G, now) {
  if (!G.clock || G.turnStart == null) return true;
  const cfg = CLOCKS[G.clockKey];
  const c = G.clock[colorName(G.turn)];
  let el = now - G.turnStart;
  G.turnStart = null;
  if (c.main > 0) {
    if (el <= c.main) { c.main -= el; return true; }
    el -= c.main; c.main = 0;
  }
  // byo-yomi: each full period used up is lost; a move inside a period resets it
  const lost = Math.floor(el / cfg.periodMs);
  c.periods -= lost;
  return c.periods > 0;
}

function startClock(io, room, now = Date.now()) {
  const G = room.game;
  if (G.timer) { clearTimeout(G.timer); G.timer = null; }
  if (!G.clock || G.phase !== "play") return;
  const cfg = CLOCKS[G.clockKey];
  const c = G.clock[colorName(G.turn)];
  G.turnStart = now;
  const ms = c.main + c.periods * cfg.periodMs;
  G.timer = setTimeout(() => {
    G.timer = null;
    if (G.phase !== "play") return;
    charge(G, Date.now() + 5);
    G.clock[colorName(G.turn)].periods = 0;
    finish(room, { winner: colorName(opp(G.turn)), reason: "timeout" });
    io && io.emit && room.__emit && room.__emit();
  }, ms + 20);
  if (G.timer.unref) G.timer.unref();
}

function play(room, seat, payload, ctx, now = Date.now()) {
  const G = room.game;
  if (G.phase !== "play") return { ok: false, error: "Không ở giai đoạn đánh quân." };
  const color = seatColor(G, seat);
  if (G.turn !== color) return { ok: false, error: "Chưa tới lượt bạn." };
  const { x, y } = payload || {};
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= G.size || y >= G.size) return { ok: false, error: "Toạ độ không hợp lệ." };
  const i = y * G.size + x;
  const res = tryMove(G.board, G.size, i, color, G.history);
  if (!res.ok) return res;
  if (!charge(G, now)) {
    finish(room, { winner: colorName(opp(color)), reason: "timeout" });
    return { ok: true };
  }
  G.board = res.board;
  G.history.add(G.board.join(""));
  G.moves += 1;
  G.moveNo[i] = G.moves;
  for (const s of res.captured) G.moveNo[s] = 0;
  G.captures[colorName(color)] += res.captured.length;
  G.lastMove = { x, y, n: G.moves };
  G.lastCaptured = res.captured;
  G.passes = 0;
  G.turn = opp(color);
  startClock(ctx && ctx.io, room, now);
  return { ok: true };
}

function pass(room, seat, _p, ctx, now = Date.now()) {
  const G = room.game;
  if (G.phase !== "play") return { ok: false, error: "Không ở giai đoạn đánh quân." };
  const color = seatColor(G, seat);
  if (G.turn !== color) return { ok: false, error: "Chưa tới lượt bạn." };
  if (!charge(G, now)) { finish(room, { winner: colorName(opp(color)), reason: "timeout" }); return { ok: true }; }
  G.passes += 1;
  G.moves += 1;
  G.lastMove = { pass: true, color: colorName(color), n: G.moves };
  G.lastCaptured = [];
  G.turn = opp(color);
  if (G.passes >= 2) {
    G.phase = "mark";
    if (G.timer) { clearTimeout(G.timer); G.timer = null; }
    G.turnStart = null;
    G.dead = new Set();
    G.accepted = { black: false, white: false };
    return { ok: true };
  }
  startClock(ctx && ctx.io, room, now);
  return { ok: true };
}

function toggleDead(room, seat, payload) {
  const G = room.game;
  if (G.phase !== "mark") return { ok: false, error: "Chưa tới giai đoạn đánh dấu quân chết." };
  const { x, y } = payload || {};
  const i = y * G.size + x;
  if (!(i >= 0 && i < G.board.length) || G.board[i] === EMPTY) return { ok: false, error: "Chọn một nhóm quân." };
  const g = group(G.board, G.size, i);
  // toggle the whole connected group
  const makeDead = !G.dead.has(i);
  for (const s of g.stones) makeDead ? G.dead.add(s) : G.dead.delete(s);
  G.accepted = { black: false, white: false };
  return { ok: true };
}

function accept(room, seat) {
  const G = room.game;
  if (G.phase !== "mark") return { ok: false, error: "Chưa tới giai đoạn đánh dấu quân chết." };
  G.accepted[colorName(seatColor(G, seat))] = true;
  if (G.accepted.black && G.accepted.white) {
    const s = scoreArea(G.board, G.size, G.dead, G.komi);
    finish(room, { winner: s.winner, reason: "score", black: s.black, white: s.white, margin: s.margin, owner: s.owner });
  }
  return { ok: true };
}

function resume(room) {
  const G = room.game;
  if (G.phase !== "mark") return { ok: false, error: "Không ở giai đoạn đánh dấu." };
  G.phase = "play"; G.passes = 0; G.dead = new Set();
  return { ok: true };
}

function resign(room, seat) {
  const G = room.game;
  if (G.phase === "over") return { ok: false, error: "Ván đã kết thúc." };
  charge(G, Date.now());
  finish(room, { winner: colorName(opp(seatColor(G, seat))), reason: "resign" });
  return { ok: true };
}

function view(room, seat) {
  const G = room.game;
  const myColor = seat ? seatColor(G, seat) : null;
  let illegal = [];
  if (G.phase === "play" && myColor === G.turn) {
    for (let i = 0; i < G.board.length; i++) if (G.board[i] === EMPTY && !tryMove(G.board, G.size, i, myColor, G.history).ok) illegal.push(i);
  }
  const prov = G.phase === "mark" ? scoreArea(G.board, G.size, G.dead, G.komi) : null;
  return {
    size: G.size, komi: G.komi, clockKey: G.clockKey, clockLabel: CLOCKS[G.clockKey] ? CLOCKS[G.clockKey].label : "Không giới hạn",
    periodMs: CLOCKS[G.clockKey] ? CLOCKS[G.clockKey].periodMs : 0,
    myColor: myColor ? colorName(myColor) : null,
    board: G.board, moveNo: G.moveNo, turn: colorName(G.turn), moves: G.moves,
    lastMove: G.lastMove, lastCaptured: G.lastCaptured, captures: G.captures,
    phase: G.phase, dead: [...G.dead], accepted: G.accepted, illegal,
    provisional: prov && { black: prov.black, white: prov.white, owner: prov.owner, winner: prov.winner, margin: prov.margin },
    result: G.result,
    clock: G.clock && {
      black: { ...G.clock.black }, white: { ...G.clock.white },
      running: G.turnStart != null ? colorName(G.turn) : null,
      elapsedMs: G.turnStart != null ? Date.now() - G.turnStart : 0,
    },
  };
}

let kit;
kit = createRoomKit("go", {
  newGame,
  onStart(room, ctx) {
    room.__emit = () => ctx.emit(room);
    startClock(ctx.io, room);
  },
  view,
  isOver: (room) => room.game.phase === "over",
  dispose: (room) => room.game.timer && clearTimeout(room.game.timer),
  actions: {
    play: (room, seat, p, ctx) => play(room, seat, p, ctx),
    pass: (room, seat, p, ctx) => pass(room, seat, p, ctx),
    toggle: (room, seat, p) => toggleDead(room, seat, p),
    accept: (room, seat) => accept(room, seat),
    resume: (room) => resume(room),
    resign: (room, seat) => resign(room, seat),
  },
});

module.exports = {
  registerGo: kit.register,
  _test: { tryMove, group, scoreArea, newGame, play, pass, toggleDead, accept, resign, view, charge, startClock, B, W, EMPTY, KOMI },
};
