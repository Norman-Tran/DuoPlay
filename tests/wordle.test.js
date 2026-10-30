// node tests/wordle.test.js
const assert = require("assert");
const W = require("../wordle-server.js")._test;
let pass = 0;
const test = (n, f) => { f(); pass++; console.log("ok -", n); };
const S = (g, a) => W.scoreGuess(g, a).map((x) => x[0]).join(""); // c/p/a

test("all correct", () => assert.equal(S("crane", "crane"), "ccccc"));
test("crane vs react", () => assert.equal(S("crane", "react"), "ppcap"));
test("duplicate in guess, single in answer: only one marked", () => {
  // answer has one 'e'; guess 'geese' -> first e present? greens first: e at 2? answer 'those' e at 4
  assert.deepEqual(W.scoreGuess("geese", "those"), ["absent", "absent", "absent", "correct", "correct"]);
});
test("green takes priority over earlier yellow", () => {
  // answer 'abbey' one e at 3; guess 'keep' style: 'eerie'
  assert.deepEqual(W.scoreGuess("eerie", "abbey"), ["present", "absent", "absent", "absent", "absent"]);
  assert.deepEqual(W.scoreGuess("lever", "eaten"), ["absent", "present", "absent", "correct", "absent"]);
});
test("speed vs abide", () => {
  assert.deepEqual(W.scoreGuess("speed", "abide"), ["absent", "absent", "present", "absent", "present"]);
});
test("two yellows when answer has two", () => {
  assert.deepEqual(W.scoreGuess("ellen", "eagle"), ["correct", "present", "absent", "present", "absent"]);
});

function room(answer) {
  const r = { score: { host: 0, guest: 0 } };
  W.newGame(r, {}, false, answer);
  r.game.startedAt = 0;
  return r;
}
test("rejects word not in dictionary", () => {
  const r = room("crane");
  const res = W.guess(r, "host", { word: "xqzzv" }, 10);
  assert.equal(res.ok, false); assert.equal(res.code, "invalid"); assert.equal(r.game.host.guesses.length, 0);
});
test("fewer guesses wins even if slower", () => {
  const r = room("crane");
  W.guess(r, "guest", "slate", 100); W.guess(r, "guest", "crane", 200); // guest: 2 guesses
  assert.equal(r.game.winner, null);
  W.guess(r, "host", "crane", 5000); // host: 1 guess
  assert.equal(r.game.winner, "host"); assert.equal(r.score.host, 1);
});
test("early decision when opponent cannot beat it", () => {
  const r = room("crane");
  W.guess(r, "host", "slate", 1); W.guess(r, "host", "crane", 2);
  assert.equal(r.game.winner, null);
  W.guess(r, "guest", "pious", 3); assert.equal(r.game.winner, null);
  W.guess(r, "guest", "mount", 4); assert.equal(r.game.winner, "host");
});
test("same guess count: faster wins", () => {
  const r = room("crane");
  W.guess(r, "host", "slate", 1); W.guess(r, "guest", "slate", 2);
  W.guess(r, "guest", "crane", 900); W.guess(r, "host", "crane", 1200);
  assert.equal(r.game.winner, "guest");
});
test("both fail -> draw and word revealed", () => {
  const r = room("crane");
  const ws = ["slate", "pious", "mount", "dwarf", "ghost", "lucky"];
  for (const w of ws) { W.guess(r, "host", w, 1); W.guess(r, "guest", w, 1); }
  assert.equal(r.game.winner, "draw");
  assert.equal(W.view(r, "host").answer, "crane");
});
test("opponent letters hidden during play", () => {
  const r = room("crane");
  W.guess(r, "guest", "slate", 1);
  const v = W.view(r, "host");
  assert.equal(v.opp.words, null); assert.equal(v.opp.rows.length, 1); assert.equal(v.answer, null);
  assert.ok(!JSON.stringify(v).includes("slate"));
});
console.log(`\n${pass} passed`);
