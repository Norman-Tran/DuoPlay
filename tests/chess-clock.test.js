// node tests/chess-clock.test.js
const assert = require("assert");
const { Chess } = require("chess.js");
const { _test: T } = require("../chess-server.js");
let pass = 0;
function test(name, fn) { fn(); pass++; console.log("ok -", name); }
function room(tc, fen) {
  const r = T.newRoom("h", tc);
  r.guestId = "g"; r.hostReady = true; r.guestReady = true;
  if (fen) r.game = new Chess(fen);
  return r;
}
const done = (r) => T.clearTurnTimer(r);

test("clock does not run before each side's first move", () => {
  const r = room("3+2"); let t = 1000;
  T.applyMove(null, r, "e4", t); assert.equal(r.turnStart, null); assert.equal(r.clock.white, 180000);
  T.applyMove(null, r, "e5", (t += 5000)); assert.equal(r.clock.black, 180000);
  assert.equal(r.turnStart, t); done(r);
});
test("increment applied after a timed move", () => {
  const r = room("3+2"); let t = 0;
  T.applyMove(null, r, "e4", t); T.applyMove(null, r, "e5", t);
  T.applyMove(null, r, "Nf3", (t += 4000));
  assert.equal(r.clock.white, 180000 - 4000 + 2000);
  T.applyMove(null, r, "Nc6", (t += 1500));
  assert.equal(r.clock.black, 180000 - 1500 + 2000); done(r);
});
test("flag fall: side to move loses", () => {
  const r = room("1+0"); let t = 0;
  T.applyMove(null, r, "e4", t); T.applyMove(null, r, "e5", t);
  T.onFlag(null, r, t + 60001);
  assert.equal(r.winner, "black"); assert.equal(r.endReason, "timeout"); assert.equal(r.scoreBlack, 1);
});
test("late move after time expired is rejected and flags", () => {
  const r = room("1+0"); let t = 0;
  T.applyMove(null, r, "e4", t); T.applyMove(null, r, "e5", t);
  const res = T.applyMove(null, r, "Nf3", t + 61000);
  assert.equal(res.ok, false); assert.equal(r.winner, "black");
});
function flagWithFen(fen) {
  const r = room("1+0", fen);
  r.turnStart = 0; r.clock.white = 500;
  T.onFlag(null, r, 1000); return r;
}
test("flag fall vs lone king -> draw (FIDE 6.9)", () => {
  const r = flagWithFen("4k3/8/8/8/8/8/4P3/4K3 w - - 0 40");
  assert.equal(r.winner, "draw"); assert.equal(r.endReason, "timeout-draw");
});
test("flag fall vs K+N -> draw", () => {
  const r = flagWithFen("4k3/8/5n2/8/8/8/4P3/4K3 w - - 0 40");
  assert.equal(r.winner, "draw");
});
test("flag fall vs K+R -> loss", () => {
  const r = flagWithFen("4k3/8/5r2/8/8/8/4P3/4K3 w - - 0 40");
  assert.equal(r.winner, "black");
});
test("unlimited: no clock, no flag", () => {
  const r = room("unlimited"); let t = 0;
  for (const m of ["e4", "e5", "Nf3", "Nc6"]) T.applyMove(null, r, m, (t += 10_000_000));
  assert.equal(r.turnStart, null); assert.equal(r.turnTimer, null);
  T.onFlag(null, r, t + 1e9); assert.equal(r.winner, null);
});
test("history exposed in public state", () => {
  const r = room("5+0");
  T.applyMove(null, r, "e4", 0); T.applyMove(null, r, "d5", 0); T.applyMove(null, r, "exd5", 0);
  const h = T.publicRoom(r).history;
  assert.equal(h.length, 3); assert.equal(h[2].captured, "p"); assert.equal(h[2].from, "e4"); done(r);
});
console.log(`\n${pass} passed`);
