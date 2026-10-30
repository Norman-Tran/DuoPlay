// node tests/uno.test.js
const assert = require("assert");
const U = require("../uno-server.js")._test;
let pass = 0;
const test = (n, f) => { f(); pass++; console.log("ok -", n); };
let uid = 1000;
const C = (s) => { // "r5", "gskip", "bdraw2", "yreverse", "wild", "wild4"
  if (s === "wild" || s === "wild4") return { id: `t${uid++}`, color: "w", value: s };
  return { id: `t${uid++}`, color: s[0], value: s.slice(1) };
};
function room(target = 500) { const r = { score: { host: 0, guest: 0 } }; U.newGame(r, { target }); U.dealRound(r); return r; }
function setup(r, { host, guest, top = "r5", color, turn = "host", deck = [] }) {
  const R = r.game.round;
  R.hands.host = host.map(C); R.hands.guest = guest.map(C);
  const t = C(top); R.discard = [t]; R.color = color || t.color; R.deck = deck.map(C);
  R.turn = turn; R.pending = null; R.result = null;
  R.unoSafe = { host: false, guest: false }; R.vulnerable = { host: false, guest: false };
  return R;
}
const id = (R, seat, i = 0) => R.hands[seat][i].id;

test("deck composition: 108 cards", () => {
  const d = U.buildDeck(); assert.equal(d.length, 108);
  const count = (f) => d.filter(f).length;
  for (const c of ["r", "y", "g", "b"]) {
    assert.equal(count((x) => x.color === c), 25);
    assert.equal(count((x) => x.color === c && x.value === "0"), 1);
    assert.equal(count((x) => x.color === c && x.value === "7"), 2);
    for (const v of ["skip", "reverse", "draw2"]) assert.equal(count((x) => x.color === c && x.value === v), 2);
  }
  assert.equal(count((x) => x.value === "wild"), 4); assert.equal(count((x) => x.value === "wild4"), 4);
  assert.equal(new Set(d.map((x) => x.id)).size, 108);
});
test("deal: 7 each, start card never Wild Draw 4, totals 108", () => {
  for (let i = 0; i < 200; i++) {
    const R = room().game.round;
    assert.equal(R.discard[0].value === "wild4", false);
    const n = R.hands.host.length + R.hands.guest.length + R.deck.length + R.discard.length;
    assert.equal(n, 108);
    assert.ok(R.hands.host.length >= 7 && R.hands.guest.length >= 7);
  }
});
test("legal plays: colour, number, symbol, wild", () => {
  const top = C("r5");
  assert.ok(U.isPlayable(C("r9"), top, "r")); assert.ok(U.isPlayable(C("b5"), top, "r"));
  assert.ok(!U.isPlayable(C("b7"), top, "r")); assert.ok(U.isPlayable(C("wild"), top, "r"));
  assert.ok(U.isPlayable(C("gskip"), C("bskip"), "b"));
  const r = room(); const R = setup(r, { host: ["b7", "r1"], guest: ["g1", "g2"] });
  assert.equal(U.play(r, "host", { card: id(R, "host", 0) }).ok, false);
  assert.equal(U.play(r, "host", { card: id(R, "host", 1) }).ok, true);
  assert.equal(R.turn, "guest");
});
test("2-player reverse acts as skip (and skip, draw two)", () => {
  const r = room(); const R = setup(r, { host: ["rreverse", "rskip", "rdraw2", "g1"], guest: ["b1"] });
  U.play(r, "host", { card: id(R, "host", 0) }); assert.equal(R.turn, "host");
  U.play(r, "host", { card: id(R, "host", 0) }); assert.equal(R.turn, "host");
  U.play(r, "host", { card: id(R, "host", 0) }); assert.equal(R.turn, "host"); assert.equal(R.hands.guest.length, 3);
});
test("wild requires colour and sets it", () => {
  const r = room(); const R = setup(r, { host: ["wild", "g1"], guest: ["b1"] });
  assert.equal(U.play(r, "host", { card: id(R, "host", 0) }).needColor, true);
  assert.equal(U.play(r, "host", { card: id(R, "host", 0), color: "g" }).ok, true);
  assert.equal(R.color, "g"); assert.equal(R.turn, "guest");
});
test("wild draw four: accept -> draw 4 and lose turn", () => {
  const r = room(); const R = setup(r, { host: ["wild4", "b1", "b2"], guest: ["g1"], deck: Array(10).fill("y3") });
  U.play(r, "host", { card: id(R, "host", 0), color: "b" });
  assert.equal(R.pending.type, "wd4"); assert.equal(R.turn, "guest");
  U.respondWd4(r, "guest", { challenge: false });
  assert.equal(R.hands.guest.length, 5); assert.equal(R.turn, "host");
});
test("wild draw four challenge: guilty -> offender draws 4", () => {
  const r = room(); const R = setup(r, { host: ["wild4", "r1", "b2"], guest: ["g1"], deck: Array(10).fill("y3") });
  U.play(r, "host", { card: id(R, "host", 0), color: "b" }); // had red (current colour) -> guilty
  U.respondWd4(r, "guest", { challenge: true });
  assert.equal(R.hands.host.length, 6); assert.equal(R.hands.guest.length, 1); assert.equal(R.turn, "guest");
});
test("wild draw four challenge: innocent -> challenger draws 6", () => {
  const r = room(); const R = setup(r, { host: ["wild4", "g1", "b2"], guest: ["g1"], deck: Array(10).fill("y3") });
  U.play(r, "host", { card: id(R, "host", 0), color: "b" });
  U.respondWd4(r, "guest", { challenge: true });
  assert.equal(R.hands.guest.length, 7); assert.equal(R.hands.host.length, 2); assert.equal(R.turn, "host");
});
test("draw: playable drawn card may be played; else turn passes", () => {
  let r = room(); let R = setup(r, { host: ["b7"], guest: ["g1"], deck: ["r9"] });
  U.drawCard(r, "host"); assert.equal(R.pending.type, "drawn"); assert.equal(R.turn, "host");
  assert.equal(U.play(r, "host", { card: R.hands.host[0].id }).ok, false); // only the drawn card
  assert.equal(U.play(r, "host", { card: R.pending.card }).ok, true);
  r = room(); R = setup(r, { host: ["b7"], guest: ["g1"], deck: ["y9"] });
  U.drawCard(r, "host"); assert.equal(R.turn, "guest"); assert.equal(R.pending, null);
  r = room(); R = setup(r, { host: ["b7"], guest: ["g1"], deck: ["r9"] });
  U.drawCard(r, "host"); U.keep(r, "host"); assert.equal(R.turn, "guest");
});
test("UNO penalty: caught before next turn -> draw 2; called -> safe", () => {
  let r = room(); let R = setup(r, { host: ["r1", "r2"], guest: ["g1", "g2", "g3"], deck: Array(5).fill("y3") });
  U.play(r, "host", { card: id(R, "host", 0) }); // down to 1 without calling
  assert.equal(U.view(r, "guest").round.canCatch, true);
  assert.equal(U.catchUno(r, "guest").ok, true); assert.equal(R.hands.host.length, 3);
  r = room(); R = setup(r, { host: ["r1", "r2"], guest: ["g1", "g2", "g3"] });
  U.play(r, "host", { card: id(R, "host", 0), uno: true });
  assert.equal(U.catchUno(r, "guest").ok, false);
  r = room(); R = setup(r, { host: ["r1", "r2"], guest: ["g1", "g2", "g3"], deck: Array(5).fill("y3") });
  U.play(r, "host", { card: id(R, "host", 0) });
  U.drawCard(r, "guest"); // guest's turn passes back -> host's next turn starts, window closed
  assert.equal(R.turn, "host"); assert.equal(U.catchUno(r, "guest").ok, false);
});
test("reshuffle discard (except top) when draw pile empty", () => {
  const r = room(); const R = setup(r, { host: ["b7"], guest: ["g1"] });
  R.discard = [C("y1"), C("y2"), C("y3"), C("r5")]; R.deck = [];
  U.drawCard(r, "host");
  assert.equal(R.discard.length, 1); assert.equal(R.discard[0].value, "5");
  assert.equal(R.deck.length + 1, 3); // 3 reshuffled, 1 drawn
});
test("scoring: winner gets opponent card points; match to target", () => {
  assert.equal(U.handPoints([C("r7"), C("gskip"), C("wild4"), C("b0")]), 77);
  const r = room(200); r.game.matchPoints.host = 150;
  const R = setup(r, { host: ["r1"], guest: ["wild", "bdraw2", "g9"] });
  U.play(r, "host", { card: id(R, "host", 0) });
  assert.equal(R.result.winner, "host"); assert.equal(R.result.points, 79);
  assert.equal(r.game.matchWinner, "host"); assert.equal(r.score.host, 1);
});
test("hidden hands in view", () => {
  const r = room(); const R = r.game.round;
  const v = U.view(r, "host");
  assert.equal(v.round.oppCount, R.hands.guest.length);
  const s = JSON.stringify(v);
  for (const c of R.hands.guest) assert.ok(!s.includes(`"${c.id}"`));
});
console.log(`\n${pass} passed`);
