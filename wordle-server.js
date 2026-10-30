/**
 * Wordle duel: both players solve the same secret 5-letter word, 6 guesses each.
 * Word lists in ./data (SCOWL + dwyl/english-words, see data/README).
 */
const fs = require("fs");
const path = require("path");
const { createRoomKit } = require("./room-kit");

const MAX_GUESSES = 6;
const load = (f) =>
  fs.readFileSync(path.join(__dirname, "data", f), "utf8").split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]{5}$/.test(w));
const ANSWERS = load("wordle-answers.txt");
const ALLOWED = new Set([...load("wordle-allowed.txt"), ...ANSWERS]);

/**
 * NYT scoring: greens first, then yellows limited by remaining letter counts.
 * @returns {("correct"|"present"|"absent")[]}
 */
function scoreGuess(guess, answer) {
  const res = Array(5).fill("absent");
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) res[i] = "correct";
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === "correct") continue;
    if (left[guess[i]] > 0) {
      res[i] = "present";
      left[guess[i]] -= 1;
    }
  }
  return res;
}

function newPlayer() {
  return { guesses: [], solved: false, solvedMs: null };
}
const finished = (p) => p.solved || p.guesses.length >= MAX_GUESSES;

/**
 * Decide the duel. Fewer guesses wins; same count -> faster solve wins.
 * Can decide early when the remaining player can no longer match/beat.
 * @returns {"host"|"guest"|"draw"|null}
 */
function decide(h, g) {
  if (h.solved && g.solved) {
    if (h.guesses.length !== g.guesses.length) return h.guesses.length < g.guesses.length ? "host" : "guest";
    if (h.solvedMs !== g.solvedMs) return h.solvedMs < g.solvedMs ? "host" : "guest";
    return "draw";
  }
  for (const [a, b, sa] of [[h, g, "host"], [g, h, "guest"]]) {
    // a solved; b not yet solved. b can at best solve on guess b.len+1.
    if (a.solved && !b.solved) {
      if (finished(b) || b.guesses.length >= a.guesses.length) return sa;
    }
  }
  if (finished(h) && finished(g)) return "draw";
  return null;
}

function newGame(room, _opts, rematch, forcedAnswer) {
  let answer = forcedAnswer;
  if (!answer) {
    do answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    while (rematch && answer === room.game?.answer);
  }
  room.game = { answer, host: newPlayer(), guest: newPlayer(), startedAt: null, winner: null };
}

function guess(room, seat, payload, now = Date.now()) {
  const G = room.game;
  const p = G[seat];
  if (finished(p)) return { ok: false, error: "Bạn đã hết lượt đoán." };
  const word = String((payload && payload.word) || payload || "").trim().toLowerCase();
  if (!/^[a-z]{5}$/.test(word)) return { ok: false, error: "Cần đủ 5 chữ cái.", code: "short" };
  if (!ALLOWED.has(word)) return { ok: false, error: "Không có trong từ điển", code: "invalid" };
  const score = scoreGuess(word, G.answer);
  p.guesses.push({ word, score });
  if (word === G.answer) {
    p.solved = true;
    p.solvedMs = now - (G.startedAt ?? now);
  }
  const w = decide(G.host, G.guest);
  if (w) {
    G.winner = w;
    if (w !== "draw") room.score[w] += 1;
  }
  return { ok: true };
}

function view(room, seat) {
  const G = room.game;
  const opp = seat === "host" ? "guest" : "host";
  const over = Boolean(G.winner);
  const me = seat ? G[seat] : null;
  const o = seat ? G[opp] : null;
  return {
    maxGuesses: MAX_GUESSES,
    winner: G.winner,
    answer: over ? G.answer : null,
    startedAt: G.startedAt,
    me: me && { guesses: me.guesses, solved: me.solved, solvedMs: me.solvedMs },
    // opponent: colours only (letters revealed after the game)
    opp: o && {
      rows: o.guesses.map((x) => x.score),
      words: over ? o.guesses.map((x) => x.word) : null,
      solved: o.solved,
      solvedMs: o.solvedMs,
    },
  };
}

const kit = createRoomKit("wordle", {
  newGame,
  onStart(room) {
    room.game.startedAt = Date.now();
  },
  view,
  isOver: (room) => Boolean(room.game.winner),
  actions: { guess: (room, seat, payload) => guess(room, seat, payload) },
});

module.exports = {
  registerWordle: kit.register,
  rooms: kit.rooms,
  _test: { scoreGuess, decide, newGame, guess, view, ALLOWED, ANSWERS, MAX_GUESSES },
};
