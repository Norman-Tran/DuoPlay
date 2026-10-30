/**
 * Domino — double-six, Draw game, 2 players.
 * Rules (standard "Draw Dominoes", e.g. pagat.com/tile/wdom/draw.html):
 *  - 28 tiles, each player draws 7, 14 stay in the boneyard.
 *  - Round 1: holder of the highest double leads with it (no double -> highest tile).
 *    Later rounds: previous round winner leads with any tile.
 *  - A tile must match an open end. Doubles are laid crosswise (UI).
 *  - Can't play -> draw from the boneyard until you can; boneyard empty -> pass.
 *  - Domino (empty hand): score opponent's remaining pips.
 *    Blocked (nobody can play): lower pip count wins and scores the difference.
 *  - Match to 50/100/150 points.
 */
const { createRoomKit } = require("./room-kit");

const TARGETS = [50, 100, 150];
const seats = ["host", "guest"];
const other = (s) => (s === "host" ? "guest" : "host");
const pips = (t) => t[0] + t[1];
const handPips = (h) => h.reduce((a, t) => a + pips(t), 0);
const tid = (t) => `${t[0]}-${t[1]}`;

function fullSet() {
  const out = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) out.push([a, b]);
  return out;
}
function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Compare tiles: doubles beat non-doubles, then higher pips, then higher high half. */
function rankTile(t) {
  return (t[0] === t[1] ? 100 : 0) + pips(t) * 7 + Math.max(t[0], t[1]);
}

/** Who leads the first round and with which tile. */
function firstPlayer(hands) {
  let best = null;
  for (const s of seats) for (const t of hands[s]) {
    const r = rankTile(t);
    if (!best || r > best.r) best = { seat: s, tile: t, r };
  }
  return { seat: best.seat, tile: best.tile };
}

function ends(R) {
  if (!R.chain.length) return null;
  return { left: R.chain[0].a, right: R.chain[R.chain.length - 1].b };
}

/** Legal sides for a tile ("left"/"right"/"any" when board empty). */
function legalSides(R, t) {
  const e = ends(R);
  if (!e) {
    if (R.mustLead && tid(R.mustLead) !== tid(t)) return [];
    return ["any"];
  }
  const out = [];
  if (t[0] === e.left || t[1] === e.left) out.push("left");
  if (t[0] === e.right || t[1] === e.right) out.push("right");
  return out;
}
const canPlay = (R, hand) => hand.some((t) => legalSides(R, t).length > 0);

function dealRound(room, rnd) {
  const G = room.game;
  const tiles = shuffle(fullSet(), rnd);
  const R = {
    hands: { host: tiles.slice(0, 7), guest: tiles.slice(7, 14) },
    boneyard: tiles.slice(14),
    chain: [], // {a,b,double,seat,n}; chain[i].b === chain[i+1].a
    anchor: 0, // index of the first tile in chain
    turn: null,
    mustLead: null,
    passes: 0,
    seq: 0,
    lastEvent: null,
    result: null,
  };
  if (G.nextLeader) {
    R.turn = G.nextLeader;
  } else {
    const fp = firstPlayer(R.hands);
    R.turn = fp.seat;
    R.mustLead = fp.tile;
  }
  G.round = R;
  G.roundNo += 1;
}

function newGame(room, opts) {
  const target = TARGETS.includes(Number(opts && opts.target)) ? Number(opts.target) : 100;
  room.game = { target, roundNo: 0, round: null, nextLeader: null, matchWinner: null, matchPoints: { host: 0, guest: 0 } };
}

function endRound(room, winner, points, reason) {
  const G = room.game;
  const R = G.round;
  R.result = {
    winner, points, reason,
    pips: { host: handPips(R.hands.host), guest: handPips(R.hands.guest) },
    hands: { host: R.hands.host, guest: R.hands.guest },
  };
  R.turn = null;
  if (winner) {
    G.matchPoints[winner] += points;
    G.nextLeader = winner;
    if (G.matchPoints[winner] >= G.target) {
      G.matchWinner = winner;
      room.score[winner] += 1;
    }
  }
}

function checkBlocked(room) {
  const R = room.game.round;
  if (R.boneyard.length) return false;
  if (seats.some((s) => canPlay(R, R.hands[s]))) return false;
  const h = handPips(R.hands.host), g = handPips(R.hands.guest);
  if (h === g) endRound(room, null, 0, "blocked");
  else endRound(room, h < g ? "host" : "guest", Math.abs(h - g), "blocked");
  return true;
}

/** Advance turn; auto-pass a player who cannot play and cannot draw. */
function advance(room, from) {
  const R = room.game.round;
  if (checkBlocked(room)) return;
  R.turn = other(from);
  if (!canPlay(R, R.hands[R.turn]) && !R.boneyard.length) {
    R.lastEvent = { type: "pass", seat: R.turn, seq: ++R.seq };
    R.turn = from;
    // `from` must be able to play here, otherwise checkBlocked would have fired
  }
}

function play(room, seat, payload) {
  const G = room.game;
  const R = G.round;
  if (!R || R.result) return { ok: false, error: "Ván chưa bắt đầu." };
  if (R.turn !== seat) return { ok: false, error: "Chưa tới lượt bạn." };
  const hand = R.hands[seat];
  const idx = hand.findIndex((t) => tid(t) === String(payload && payload.tile));
  if (idx < 0) return { ok: false, error: "Bạn không có quân này." };
  const t = hand[idx];
  const sides = legalSides(R, t);
  if (!sides.length) return { ok: false, error: R.mustLead && !R.chain.length ? `Phải đi quân ${tid(R.mustLead)} trước.` : "Quân này không nối được." };
  let side = payload.side;
  if (!sides.includes(side)) {
    if (sides.length === 1) side = sides[0];
    else return { ok: false, error: "Chọn đầu để nối (trái/phải).", needSide: true };
  }
  const dbl = t[0] === t[1];
  const n = R.chain.length;
  if (side === "any") {
    R.chain.push({ a: t[0], b: t[1], double: dbl, seat, n });
    R.anchor = 0;
  } else if (side === "left") {
    const e = R.chain[0].a;
    const a = t[0] === e ? t[1] : t[0];
    R.chain.unshift({ a, b: e, double: dbl, seat, n });
    R.anchor += 1;
  } else {
    const e = R.chain[R.chain.length - 1].b;
    const b = t[0] === e ? t[1] : t[0];
    R.chain.push({ a: e, b, double: dbl, seat, n });
  }
  hand.splice(idx, 1);
  R.mustLead = null;
  R.lastEvent = { type: "play", seat, tile: tid(t), side, seq: ++R.seq };
  if (!hand.length) {
    endRound(room, seat, handPips(R.hands[other(seat)]), "domino");
    return { ok: true };
  }
  advance(room, seat);
  return { ok: true };
}

function draw(room, seat) {
  const R = room.game.round;
  if (!R || R.result) return { ok: false, error: "Ván chưa bắt đầu." };
  if (R.turn !== seat) return { ok: false, error: "Chưa tới lượt bạn." };
  if (canPlay(R, R.hands[seat])) return { ok: false, error: "Bạn còn quân đánh được, không cần bốc." };
  if (!R.boneyard.length) {
    advance(room, seat);
    return { ok: true, passed: true };
  }
  const t = R.boneyard.pop();
  R.hands[seat].push(t);
  R.lastEvent = { type: "draw", seat, seq: ++R.seq };
  // still stuck with an empty boneyard -> pass
  if (!canPlay(R, R.hands[seat]) && !R.boneyard.length) {
    R.lastEvent = { type: "pass", seat, seq: ++R.seq };
    advance(room, seat);
  }
  return { ok: true, drawn: tid(t) };
}

function nextRound(room) {
  const G = room.game;
  if (!G.round || !G.round.result) return { ok: false, error: "Ván hiện tại chưa xong." };
  if (G.matchWinner) return { ok: false, error: "Trận đã kết thúc. Hãy chơi lại." };
  dealRound(room);
  return { ok: true };
}

function view(room, seat) {
  const G = room.game;
  const R = G.round;
  const opp = seat ? other(seat) : null;
  return {
    target: G.target,
    targets: TARGETS,
    roundNo: G.roundNo,
    matchPoints: G.matchPoints,
    matchWinner: G.matchWinner,
    round: R && {
      chain: R.chain,
      anchor: R.anchor,
      ends: ends(R),
      turn: R.turn,
      mustLead: R.mustLead ? tid(R.mustLead) : null,
      boneyard: R.boneyard.length,
      myHand: seat ? R.hands[seat].map(tid) : [],
      oppCount: opp ? R.hands[opp].length : 0,
      canPlay: seat ? canPlay(R, R.hands[seat]) : false,
      lastEvent: R.lastEvent,
      result: R.result,
    },
  };
}

const kit = createRoomKit("domino", {
  newGame,
  onStart(room) {
    if (!room.game.round) dealRound(room);
  },
  view,
  isOver: (room) => Boolean(room.game.matchWinner),
  actions: {
    play: (room, seat, p) => play(room, seat, p),
    draw: (room, seat) => draw(room, seat),
    "next-round": (room) => nextRound(room),
  },
});

module.exports = {
  registerDomino: kit.register,
  rooms: kit.rooms,
  _test: { fullSet, firstPlayer, legalSides, dealRound, newGame, play, draw, view, handPips, canPlay, nextRound, checkBlocked },
};
