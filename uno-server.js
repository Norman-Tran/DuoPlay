/**
 * UNO — 2 players, official Mattel rules (2-player variant):
 *  - 108 cards: per colour one 0, two each of 1–9, Skip, Reverse, Draw Two; 4 Wild, 4 Wild Draw Four.
 *  - Deal 7 each; flip the top card to start the discard pile. A Wild Draw Four is returned and the deck reshuffled.
 *    Starting Skip/Reverse/Draw Two/Wild apply to the first player (Wild: first player picks the colour).
 *  - Match colour, number or symbol. With 2 players Reverse works like Skip; Skip/Reverse/Draw Two let you play again.
 *  - Wild Draw Four may only be played legally when you hold no card of the current colour. The next player may
 *    challenge: if guilty, the offender draws 4 instead; if innocent, the challenger draws 6 (4+2).
 *  - Can't (or don't want to) play: draw one; if it's playable you may play it immediately, otherwise the turn passes.
 *  - UNO: call it when going down to one card. If you didn't and the opponent catches you before your next turn starts, draw 2.
 *  - Empty draw pile: reshuffle the discard pile except its top card.
 *  - Round winner scores the opponent's cards: numbers at face value, Skip/Reverse/Draw Two 20, Wilds 50. Match to 200/300/500.
 */
const { createRoomKit } = require("./room-kit");

const COLORS = ["r", "y", "g", "b"];
const TARGETS = [200, 300, 500];
const other = (s) => (s === "host" ? "guest" : "host");

function buildDeck() {
  const deck = [];
  let n = 0;
  const add = (color, value) => deck.push({ id: `c${n++}`, color, value });
  for (const c of COLORS) {
    add(c, "0");
    for (let k = 0; k < 2; k++) {
      for (let v = 1; v <= 9; v++) add(c, String(v));
      add(c, "skip"); add(c, "reverse"); add(c, "draw2");
    }
  }
  for (let k = 0; k < 4; k++) { add("w", "wild"); add("w", "wild4"); }
  return deck;
}
function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const cardPoints = (c) => (c.color === "w" ? 50 : /^\d$/.test(c.value) ? Number(c.value) : 20);
const handPoints = (h) => h.reduce((a, c) => a + cardPoints(c), 0);

function isPlayable(card, top, color) {
  if (card.color === "w") return true;
  return card.color === color || card.value === top.value;
}

function draw(R, seat, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!R.deck.length) reshuffle(R);
    if (!R.deck.length) break;
    const c = R.deck.pop();
    R.hands[seat].push(c);
    got.push(c.id);
  }
  if (R.hands[seat].length > 1) { R.unoSafe[seat] = false; R.vulnerable[seat] = false; }
  return got;
}
function reshuffle(R) {
  if (R.discard.length <= 1) return;
  const top = R.discard.pop();
  R.deck = shuffle(R.discard);
  R.discard = [top];
  R.reshuffles += 1;
}

function newGame(room, opts) {
  const target = TARGETS.includes(Number(opts && opts.target)) ? Number(opts.target) : 500;
  room.game = { target, roundNo: 0, round: null, matchPoints: { host: 0, guest: 0 }, matchWinner: null, starter: "guest" };
}

function dealRound(room, rnd) {
  const G = room.game;
  let deck;
  // flip start card; Wild Draw Four goes back and the deck is reshuffled
  for (;;) {
    deck = shuffle(buildDeck(), rnd);
    if (deck[14].value !== "wild4") break;
  }
  const R = {
    hands: { host: deck.slice(0, 7), guest: deck.slice(7, 14) },
    discard: [deck[14]],
    deck: deck.slice(15),
    color: deck[14].color,
    turn: null,
    pending: null, // {type:"wd4", by, guilty} | {type:"color", seat} | {type:"drawn", seat, card}
    unoSafe: { host: false, guest: false },
    vulnerable: { host: false, guest: false },
    seq: 0, lastEvent: null, result: null, reshuffles: 0,
  };
  G.starter = other(G.starter);
  G.round = R;
  G.roundNo += 1;
  const first = G.starter;
  const top = R.discard[0];
  R.turn = first;
  R.lastEvent = { type: "start", card: top.id, seq: ++R.seq };
  if (top.value === "skip" || top.value === "reverse") R.turn = other(first);
  else if (top.value === "draw2") { draw(R, first, 2); R.turn = other(first); }
  else if (top.value === "wild") R.pending = { type: "color", seat: first };
}

function startTurn(R, seat) {
  R.turn = seat;
  R.vulnerable[seat] = false; // catch window closes when your next turn starts
}

function endRound(room, winner) {
  const G = room.game;
  const R = G.round;
  const loser = other(winner);
  const points = handPoints(R.hands[loser]);
  R.result = { winner, points, hand: R.hands[loser].map((c) => ({ ...c })) };
  R.turn = null;
  R.pending = null;
  G.matchPoints[winner] += points;
  if (G.matchPoints[winner] >= G.target) {
    G.matchWinner = winner;
    room.score[winner] += 1;
  }
}

function play(room, seat, payload) {
  const R = room.game.round;
  if (!R || R.result) return { ok: false, error: "Ván chưa bắt đầu." };
  if (R.turn !== seat) return { ok: false, error: "Chưa tới lượt bạn." };
  if (R.pending && R.pending.type !== "drawn") return { ok: false, error: "Đang chờ xử lý lá trước." };
  const hand = R.hands[seat];
  const idx = hand.findIndex((c) => c.id === (payload && payload.card));
  if (idx < 0) return { ok: false, error: "Bạn không có lá này." };
  if (R.pending && R.pending.type === "drawn" && R.pending.card !== hand[idx].id)
    return { ok: false, error: "Sau khi bốc, chỉ được đánh lá vừa bốc." };
  const card = hand[idx];
  const top = R.discard[R.discard.length - 1];
  if (!isPlayable(card, top, R.color)) return { ok: false, error: "Lá này không hợp lệ." };
  if (card.color === "w" && !COLORS.includes(payload.color)) return { ok: false, error: "Chọn màu cho lá Đổi màu.", needColor: true };
  const guilty = card.value === "wild4" && hand.some((c) => c.id !== card.id && c.color === R.color);
  hand.splice(idx, 1);
  R.discard.push(card);
  R.color = card.color === "w" ? payload.color : card.color;
  R.pending = null;
  if (payload.uno && hand.length === 1) R.unoSafe[seat] = true;
  if (hand.length === 1 && !R.unoSafe[seat]) R.vulnerable[seat] = true;
  const opp = other(seat);
  R.lastEvent = { type: "play", seat, card: card.id, value: card.value, color: R.color, seq: ++R.seq };
  if (card.value === "draw2") {
    draw(R, opp, 2);
    if (!hand.length) { endRound(room, seat); return { ok: true }; }
    R.turn = seat; // opponent loses their turn; same player continues
    return { ok: true };
  }
  if (card.value === "wild4") {
    if (!hand.length) { draw(R, opp, 4); endRound(room, seat); return { ok: true }; }
    R.pending = { type: "wd4", by: seat, guilty };
    R.turn = opp; // opponent decides: accept or challenge
    return { ok: true };
  }
  if (!hand.length) { endRound(room, seat); return { ok: true }; }
  if (card.value === "skip" || card.value === "reverse") R.turn = seat; // 2 players: Reverse = Skip
  else startTurn(R, opp);
  return { ok: true };
}

function respondWd4(room, seat, payload) {
  const R = room.game.round;
  const P = R && R.pending;
  if (!P || P.type !== "wd4" || R.turn !== seat) return { ok: false, error: "Không có lá +4 để xử lý." };
  const by = P.by;
  R.pending = null;
  if (payload && payload.challenge) {
    if (P.guilty) {
      draw(R, by, 4);
      R.lastEvent = { type: "challenge", seat, success: true, seq: ++R.seq };
      startTurn(R, seat);
    } else {
      draw(R, seat, 6);
      R.lastEvent = { type: "challenge", seat, success: false, seq: ++R.seq };
      startTurn(R, by);
    }
  } else {
    draw(R, seat, 4);
    R.lastEvent = { type: "draw4", seat, seq: ++R.seq };
    startTurn(R, by);
  }
  return { ok: true };
}

function pickColor(room, seat, payload) {
  const R = room.game.round;
  if (!R || !R.pending || R.pending.type !== "color" || R.pending.seat !== seat) return { ok: false, error: "Không cần chọn màu." };
  if (!COLORS.includes(payload && payload.color)) return { ok: false, error: "Màu không hợp lệ." };
  R.color = payload.color;
  R.pending = null;
  return { ok: true };
}

function drawCard(room, seat) {
  const R = room.game.round;
  if (!R || R.result) return { ok: false, error: "Ván chưa bắt đầu." };
  if (R.turn !== seat) return { ok: false, error: "Chưa tới lượt bạn." };
  if (R.pending) return { ok: false, error: R.pending.type === "drawn" ? "Bạn đã bốc rồi — đánh lá đó hoặc bỏ lượt." : "Đang chờ xử lý." };
  const got = draw(R, seat, 1);
  R.lastEvent = { type: "draw", seat, count: got.length, seq: ++R.seq };
  const card = R.hands[seat].find((c) => c.id === got[0]);
  const top = R.discard[R.discard.length - 1];
  if (card && isPlayable(card, top, R.color)) R.pending = { type: "drawn", seat, card: card.id };
  else startTurn(R, other(seat));
  return { ok: true, drawn: got[0] || null };
}

function keep(room, seat) {
  const R = room.game.round;
  if (!R || !R.pending || R.pending.type !== "drawn" || R.turn !== seat) return { ok: false, error: "Không thể bỏ lượt lúc này." };
  R.pending = null;
  R.lastEvent = { type: "keep", seat, seq: ++R.seq };
  startTurn(R, other(seat));
  return { ok: true };
}

function callUno(room, seat) {
  const R = room.game.round;
  if (!R || R.result) return { ok: false, error: "Ván chưa bắt đầu." };
  const n = R.hands[seat].length;
  if (n === 1 || (n === 2 && R.turn === seat)) {
    R.unoSafe[seat] = true;
    R.vulnerable[seat] = false;
    R.lastEvent = { type: "uno", seat, seq: ++R.seq };
    return { ok: true };
  }
  return { ok: false, error: "Chỉ hô UNO khi còn 1 lá (hoặc sắp đánh xuống 1 lá)." };
}

function catchUno(room, seat) {
  const R = room.game.round;
  const opp = other(seat);
  if (!R || R.result || !R.vulnerable[opp] || R.hands[opp].length !== 1) return { ok: false, error: "Không bắt lỗi được." };
  R.vulnerable[opp] = false;
  draw(R, opp, 2);
  R.lastEvent = { type: "caught", seat: opp, seq: ++R.seq };
  return { ok: true };
}

function nextRound(room) {
  const G = room.game;
  if (!G.round || !G.round.result) return { ok: false, error: "Ván hiện tại chưa xong." };
  if (G.matchWinner) return { ok: false, error: "Trận đã kết thúc." };
  dealRound(room);
  return { ok: true };
}

function view(room, seat) {
  const G = room.game;
  const R = G.round;
  const opp = seat ? other(seat) : null;
  const top = R ? R.discard[R.discard.length - 1] : null;
  return {
    target: G.target, roundNo: G.roundNo, matchPoints: G.matchPoints, matchWinner: G.matchWinner,
    round: R && {
      top, color: R.color, discardCount: R.discard.length, deck: R.deck.length,
      turn: R.turn,
      myHand: seat ? R.hands[seat] : [],
      playable: seat && R.turn === seat && !R.pending ? R.hands[seat].filter((c) => isPlayable(c, top, R.color)).map((c) => c.id)
        : seat && R.pending && R.pending.type === "drawn" && R.pending.seat === seat ? [R.pending.card] : [],
      oppCount: opp ? R.hands[opp].length : 0,
      pending: R.pending && (R.pending.type === "wd4" ? { type: "wd4", by: R.pending.by } : R.pending),
      unoSafe: R.unoSafe,
      canCatch: Boolean(opp && R.vulnerable[opp] && R.hands[opp].length === 1),
      lastEvent: R.lastEvent,
      result: R.result,
    },
  };
}

const kit = createRoomKit("uno", {
  newGame,
  onStart(room) { if (!room.game.round) dealRound(room); },
  view,
  isOver: (room) => Boolean(room.game.matchWinner),
  actions: {
    play: (room, seat, p) => play(room, seat, p || {}),
    draw: (room, seat) => drawCard(room, seat),
    keep: (room, seat) => keep(room, seat),
    color: (room, seat, p) => pickColor(room, seat, p),
    wd4: (room, seat, p) => respondWd4(room, seat, p),
    uno: (room, seat) => callUno(room, seat),
    catch: (room, seat) => catchUno(room, seat),
    "next-round": (room) => nextRound(room),
  },
});

module.exports = {
  registerUno: kit.register,
  _test: { buildDeck, dealRound, newGame, play, drawCard, keep, respondWd4, pickColor, callUno, catchUno, nextRound, view, isPlayable, handPoints, cardPoints, reshuffle },
};
