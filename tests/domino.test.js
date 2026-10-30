// node tests/domino.test.js
const assert = require("assert");
const D = require("../domino-server.js")._test;
let pass = 0;
const test = (n, f) => { f(); pass++; console.log("ok -", n); };
const T = (s) => s.split("-").map(Number);
function room(target = 100) {
  const r = { score: { host: 0, guest: 0 } };
  D.newGame(r, { target });
  D.dealRound(r);
  return r;
}
/** Force a specific position. */
function setup(r, { host, guest, boneyard = [], chain = [], turn = "host" }) {
  const R = r.game.round;
  R.hands.host = host.map(T); R.hands.guest = guest.map(T); R.boneyard = boneyard.map(T);
  R.chain = chain.map((s, n) => { const [a, b] = T(s); return { a, b, double: a === b, seat: "host", n }; });
  R.anchor = 0; R.turn = turn; R.mustLead = null; R.result = null;
  return R;
}

test("full set has 28 unique tiles", () => {
  const s = D.fullSet(); assert.equal(s.length, 28);
  assert.equal(new Set(s.map((t) => t.join("-"))).size, 28);
});
test("deal: 7 + 7 + 14 boneyard, no duplicates", () => {
  const R = room().game.round;
  assert.equal(R.hands.host.length, 7); assert.equal(R.hands.guest.length, 7); assert.equal(R.boneyard.length, 14);
  const all = [...R.hands.host, ...R.hands.guest, ...R.boneyard].map((t) => t.join("-"));
  assert.equal(new Set(all).size, 28);
});
test("first player: highest double", () => {
  const fp = D.firstPlayer({ host: [[6, 5], [2, 2]], guest: [[4, 4], [1, 3]] });
  assert.equal(fp.seat, "guest"); assert.deepEqual(fp.tile, [4, 4]);
});
test("first player: no doubles -> highest tile", () => {
  const fp = D.firstPlayer({ host: [[6, 5], [0, 1]], guest: [[6, 4], [3, 5]] });
  assert.equal(fp.seat, "host"); assert.deepEqual(fp.tile, [6, 5]);
});
test("first round must lead with the designated tile", () => {
  const r = room(); const R = r.game.round;
  const lead = R.mustLead.join("-"); const s = R.turn;
  const other = R.hands[s].find((t) => t.join("-") !== lead);
  if (other) assert.equal(D.play(r, s, { tile: other.join("-") }).ok, false);
  assert.equal(D.play(r, s, { tile: lead }).ok, true);
  assert.equal(R.chain.length, 1);
});
test("legal-move matching and orientation", () => {
  const r = room();
  const R = setup(r, { host: ["5-3", "1-6", "2-4"], guest: ["0-0", "1-1"], chain: ["3-4"] , boneyard: ["6-6"]});
  assert.deepEqual(D.legalSides(R, T("5-3")), ["left"]);
  assert.deepEqual(D.legalSides(R, T("2-4")), ["right"]);
  assert.deepEqual(D.legalSides(R, T("1-6")), []);
  assert.equal(D.play(r, "host", { tile: "1-6" }).ok, false);
  assert.equal(D.play(r, "host", { tile: "5-3" }).ok, true);
  assert.deepEqual([R.chain[0].a, R.chain[0].b], [5, 3]); // 3 touches 3
  assert.equal(R.anchor, 1);
  for (let i = 0; i + 1 < R.chain.length; i++) assert.equal(R.chain[i].b, R.chain[i + 1].a);
});
test("tile fitting both ends requires a side choice", () => {
  const r = room();
  setup(r, { host: ["3-4", "0-1"], guest: ["5-5"], chain: ["3-2", "2-4"] });
  const res = D.play(r, "host", { tile: "3-4" });
  assert.equal(res.ok, false); assert.equal(res.needSide, true);
  assert.equal(D.play(r, "host", { tile: "3-4", side: "right" }).ok, true);
  const R = r.game.round; assert.deepEqual([R.chain.at(-1).a, R.chain.at(-1).b], [4, 3]);
});
test("draw only when stuck; draw until playable", () => {
  const r = room();
  const R = setup(r, { host: ["0-0", "1-1"], guest: ["2-6", "4-4"], chain: ["6-6"], boneyard: ["6-1", "2-3"], turn: "host" });
  assert.equal(D.draw(r, "guest").ok, false); // not their turn
  assert.equal(D.draw(r, "host").ok, true); // draws 2-3 (pop)
  assert.equal(R.hands.host.length, 3); assert.equal(R.turn, "host");
  assert.equal(D.draw(r, "host").ok, true); // draws 6-1 -> now playable
  assert.equal(D.draw(r, "host").ok, false); // cannot draw while playable
});
test("empty boneyard and stuck -> pass", () => {
  const r = room();
  const R = setup(r, { host: ["6-1"], guest: ["0-0", "2-2"], chain: ["6-5"], turn: "host" });
  // host plays 5? no: host 6-1 fits left(6). After that guest has no 1/5 and empty boneyard -> auto pass back
  R.hands.host.push(T("5-3"));
  assert.equal(D.play(r, "host", { tile: "6-1" }).ok, true);
  assert.equal(R.lastEvent.type, "pass"); assert.equal(R.lastEvent.seat, "guest"); assert.equal(R.turn, "host"); assert.equal(R.result, null);
});
test("blocked game: lower pips wins the difference", () => {
  const r = room();
  setup(r, { host: ["6-1", "0-1"], guest: ["5-5", "4-4"], chain: ["2-6"], turn: "host" });
  // host plays 6-1 -> ends 2 / 1 ; host left 0-1 fits 1! make it unplayable instead
  r.game.round.hands.host = [T("6-3"), T("0-0")];
  assert.equal(D.play(r, "host", { tile: "6-3" }).ok, true); // ends 2 / 3 ; nobody has 2 or 3
  const res = r.game.round.result;
  assert.equal(res.reason, "blocked"); assert.equal(res.winner, "host"); assert.equal(res.points, 18 - 0);
  assert.equal(r.game.matchPoints.host, 18);
});
test("domino: empty hand scores opponent pips; match to target", () => {
  const r = room(50);
  r.game.matchPoints.host = 40;
  setup(r, { host: ["6-2"], guest: ["5-6", "0-1"], chain: ["3-6"], turn: "host" });
  assert.equal(D.play(r, "host", { tile: "6-2" }).ok, true);
  const res = r.game.round.result;
  assert.equal(res.reason, "domino"); assert.equal(res.points, 12);
  assert.equal(r.game.matchWinner, "host"); assert.equal(r.score.host, 1);
  assert.equal(D.nextRound(r).ok, false);
});
test("next round led by previous winner, no forced tile", () => {
  const r = room();
  setup(r, { host: ["6-2"], guest: ["5-6"], chain: ["3-6"], turn: "host" });
  D.play(r, "host", { tile: "6-2" });
  assert.equal(D.nextRound(r).ok, true);
  assert.equal(r.game.round.turn, "host"); assert.equal(r.game.round.mustLead, null);
});
test("hidden hands: each view has only own tiles + opponent count", () => {
  const r = room();
  const vh = D.view(r, "host"), vg = D.view(r, "guest");
  const R = r.game.round;
  assert.deepEqual(vh.round.myHand, R.hands.host.map((t) => t.join("-")));
  assert.equal(vh.round.oppCount, 7);
  const s = JSON.stringify(vh);
  for (const t of R.hands.guest) assert.ok(!vh.round.myHand.includes(t.join("-")));
  assert.ok(!("hands" in vh.round)); assert.ok(!s.includes('"boneyard":['));
  assert.equal(vg.round.myHand.length, 7);
});
console.log(`\n${pass} passed`);
