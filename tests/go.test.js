// node tests/go.test.js
const assert = require("assert");
const G = require("../go-server.js")._test;
const { B, W } = G;
let pass = 0;
const test = (n, f) => { f(); pass++; console.log("ok -", n); };
/** Parse rows like ". X O" (X black, O white). */
function parse(rows) {
  const size = rows.length;
  const board = rows.flatMap((r) => r.replace(/\s+/g, "").split("").map((c) => (c === "X" ? B : c === "O" ? W : 0)));
  return { size, board };
}
function room(size = 9, clock = "none") {
  const r = { score: { host: 0, guest: 0 } };
  G.newGame(r, { size, clock });
  return r;
}
const seatOf = (r, c) => (c === B ? r.game.blackSeat : r.game.blackSeat === "host" ? "guest" : "host");
function mv(r, x, y) { return G.play(r, seatOf(r, r.game.turn), { x, y }); }

test("single stone capture", () => {
  const { size, board } = parse([".X...", "XO...", ".X...", ".....", "....."]);
  const res = G.tryMove(board, size, 2 * 5 + 1 - 5 + 1, B, null); // (2,1)
  assert.equal(res.ok, true); assert.deepEqual(res.captured, [1 * 5 + 1]);
});
test("group capture in the corner", () => {
  const { size, board } = parse(["OO...", "XX...", ".....", ".....", "....."]);
  // white group at (0,0),(1,0) has one liberty at (2,0)
  const res = G.tryMove(board, size, 2, B, null);
  assert.equal(res.ok, true); assert.equal(res.captured.length, 2);
});
test("suicide is illegal", () => {
  const { size, board } = parse([".X...", "X....", ".....", ".....", "....."]);
  const res = G.tryMove(board, size, 0, W, null);
  assert.equal(res.ok, false); assert.match(res.error, /tự sát/);
});
test("capturing move is not suicide", () => {
  const { size, board } = parse(["O.O..", "XOX..", ".X...", ".....", "....."]);
  // black at (1,0): no own liberties, but captures white (1,1)? white (1,1) libs: (1,0) only -> captured
  const res = G.tryMove(board, size, 1, B, null);
  assert.equal(res.ok, true); assert.ok(res.captured.includes(6));
});
test("ko: immediate recapture forbidden", () => {
  const r = room(9);
  // build a ko shape: black at (1,0),(0,1),(1,2); white at (2,0),(3,1),(2,2),(1,1)...
  const seq = [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2], [8, 8], [1, 1]]; // W plays (1,1)
  for (const [x, y] of seq) assert.equal(mv(r, x, y).ok, true, `move ${x},${y}`);
  // black captures at (2,1)
  assert.equal(mv(r, 2, 1).ok, true);
  assert.equal(r.game.board[1 * 9 + 1], 0);
  // white immediately retakes at (1,1) -> ko
  const res = mv(r, 1, 1);
  assert.equal(res.ok, false); assert.match(res.error, /Ko/);
  // after a ko threat elsewhere it's allowed
  assert.equal(mv(r, 7, 7).ok, true); assert.equal(mv(r, 6, 6).ok, true);
  assert.equal(mv(r, 1, 1).ok, true);
});
test("two consecutive passes -> marking phase; a move in between resets", () => {
  const r = room(9);
  G.pass(r, seatOf(r, B)); mv(r, 4, 4); G.pass(r, seatOf(r, B));
  assert.equal(r.game.phase, "play");
  G.pass(r, seatOf(r, W));
  assert.equal(r.game.phase, "mark");
});
test("area scoring of a small 9x9 position (komi 7.5)", () => {
  // black owns columns 0-3 (wall on col 3), white owns cols 5-8 (wall on col 5), col 4 dame
  const rows = Array.from({ length: 9 }, () => "...X.O...");
  const { size, board } = parse(rows);
  const s = G.scoreArea(board, size, new Set(), 7.5);
  assert.equal(s.black, 36); assert.equal(s.white, 36 + 7.5);
  assert.equal(s.winner, "white"); assert.equal(s.margin, 7.5);
  assert.equal(s.owner[4], 0); // dame
});
test("dead-stone marking: toggling a group and both accepting scores the game", () => {
  const r = room(9);
  const rows = Array.from({ length: 9 }, () => "..X.X.O..");
  rows[1] = "O.X.X.O.."; // a white stone inside black's area (dead)
  Object.assign(r.game, parse(rows));
  r.game.phase = "mark";
  const before = G.scoreArea(r.game.board, 9, new Set(), 7.5);
  assert.equal(G.toggleDead(r, "host", { x: 0, y: 1 }).ok, true);
  assert.deepEqual([...r.game.dead], [9]);
  G.accept(r, "host"); assert.equal(r.game.phase, "mark");
  // re-toggle resets acceptance
  G.toggleDead(r, "guest", { x: 0, y: 1 }); assert.equal(r.game.accepted.black, false);
  G.toggleDead(r, "guest", { x: 0, y: 1 });
  G.accept(r, "host"); G.accept(r, "guest");
  assert.equal(r.game.phase, "over");
  assert.equal(r.game.result.reason, "score");
  assert.ok(r.game.result.black > before.black); // the dead stone's point became black area
  // black area: cols 0-4 except none = 45 ; white: cols 6-8 + col 5 bordered by both? col5 between X(4) and O(6) -> dame
  assert.equal(r.game.result.black, 45); assert.equal(r.game.result.white, 27 + 7.5);
  assert.equal(r.game.result.winner, "black");
  const winnerSeat = r.game.blackSeat; assert.equal(r.score[winnerSeat], 1);
});
test("resign ends the game", () => {
  const r = room(9);
  G.resign(r, r.game.blackSeat);
  assert.equal(r.game.result.winner, "white"); assert.equal(r.game.result.reason, "resign");
});
test("byo-yomi: main time then periods, flag after last period", () => {
  const r = room(9, "5m+30x3");
  const g = r.game;
  g.turnStart = 0; assert.equal(G.charge(g, 299_000), true); assert.equal(g.clock.black.main, 1000);
  g.turnStart = 0; assert.equal(G.charge(g, 1000 + 45_000), true); assert.equal(g.clock.black.periods, 2); // lost one period
  g.turnStart = 0; assert.equal(G.charge(g, 29_000), true); assert.equal(g.clock.black.periods, 2); // within period: reset
  g.turnStart = 0; assert.equal(G.charge(g, 61_000), false);
  G.startClock(null, r); clearTimeout(g.timer);
});
test("illegal points exposed for the hover ghost", () => {
  const r = room(9);
  Object.assign(r.game, parse(Array.from({ length: 9 }, (_, y) => (y === 0 ? ".X......." : y === 1 ? "X........" : "........."))));
  r.game.turn = W;
  const whiteSeat = seatOf(r, W);
  assert.ok(G.view(r, whiteSeat).illegal.includes(0));
  assert.deepEqual(G.view(r, r.game.blackSeat).illegal, []);
});
console.log(`\n${pass} passed`);
