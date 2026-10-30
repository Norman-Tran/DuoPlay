// node tests/pool-rules.test.js
const assert = require("assert");
const pool = require("../pool-server.js");
const T = pool._test;
let pass = 0;
function room(opts = {}) {
  const r = T.newRoom("h");
  r.guestId = "g";
  r.phase = "playing";
  r.isBreak = false;
  r.turn = opts.turn || "A";
  if (opts.groups) {
    r.groupA = opts.groups.A;
    r.groupB = opts.groups.B;
    r.groupsAssigned = true;
  }
  return r;
}
function pot(r, ids) { for (const id of ids) { const b = r.balls.find((x) => x.id === id); b.pocketed = true; } }
function test(name, fn) { fn(); pass++; console.log("ok -", name); }

test("solid player pots a solid -> keeps turn", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [3]);
  T.finishShot(null, r, 3, [3], true);
  assert.equal(r.turn, "A"); assert.equal(r.phase, "playing"); assert.equal(r.lastEvent.type, "continue");
});
test("guest with solids pots a solid -> keeps turn", () => {
  const r = room({ turn: "B", groups: { A: "stripe", B: "solid" } });
  pot(r, [1]);
  T.finishShot(null, r, 1, [1], true);
  assert.equal(r.turn, "B");
});
test("solid + stripe potted, hit own first -> keeps turn", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [2, 10]);
  T.finishShot(null, r, 2, [2, 10], true);
  assert.equal(r.turn, "A");
});
test("pots only opponent ball -> turn passes", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [11]);
  T.finishShot(null, r, 4, [11], true);
  assert.equal(r.turn, "B"); assert.equal(r.ballInHand, false);
});
test("hit opponent ball first -> foul, ball in hand", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [5]);
  T.finishShot(null, r, 12, [5], true);
  assert.equal(r.turn, "B"); assert.equal(r.ballInHand, true);
});
test("scratch -> foul, opponent ball in hand", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [0, 3]);
  T.finishShot(null, r, 3, [0, 3], true);
  assert.equal(r.turn, "B"); assert.equal(r.ballInHand, true);
  assert.equal(r.balls.find((b) => b.id === 0).pocketed, false);
});
test("no ball hit -> foul", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  T.finishShot(null, r, null, [], false);
  assert.equal(r.ballInHand, true); assert.equal(r.turn, "B");
});
test("no rail after contact and nothing potted -> foul", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  T.finishShot(null, r, 2, [], false);
  assert.equal(r.ballInHand, true);
});
test("open table: first pot assigns group and keeps turn", () => {
  const r = room({ turn: "B" });
  pot(r, [13]);
  T.finishShot(null, r, 13, [13], true);
  assert.equal(r.groupB, "stripe"); assert.equal(r.groupA, "solid"); assert.equal(r.turn, "B");
});
test("break: table stays open, pot keeps turn", () => {
  const r = room(); r.isBreak = true;
  pot(r, [6]);
  T.finishShot(null, r, 1, [6], true);
  assert.equal(r.groupsAssigned, false); assert.equal(r.turn, "A");
});
test("8 early -> loss", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [8]);
  T.finishShot(null, r, 1, [8], true);
  assert.equal(r.winner, "B");
});
test("group cleared, legal 8 -> win", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [1, 2, 3, 4, 5, 6, 7]);
  pot(r, [8]);
  T.finishShot(null, r, 8, [8], true);
  assert.equal(r.winner, "A");
});
test("last solid + 8 same shot -> loss", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [1, 2, 3, 4, 5, 6]);
  pot(r, [7, 8]);
  T.finishShot(null, r, 7, [7, 8], true);
  assert.equal(r.winner, "B");
});
test("8 with scratch -> loss", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [1, 2, 3, 4, 5, 6, 7, 8, 0]);
  T.finishShot(null, r, 8, [8, 0], true);
  assert.equal(r.winner, "B");
});
test("potting last solid -> keeps turn, next legal is 8", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [1, 2, 3, 4, 5, 6, 7]);
  T.finishShot(null, r, 7, [7], true);
  assert.equal(r.turn, "A");
  assert.deepEqual(T.legalObjectTypes(r, "A"), ["eight"]);
});

test("lastShotResult: scratch foul summary", () => {
  const r = room({ groups: { A: "solid", B: "stripe" } });
  pot(r, [0]);
  T.finishShot(null, r, 3, [0], true);
  const x = r.lastShotResult;
  assert.equal(x.foul, true); assert.equal(x.keptTurn, false); assert.equal(x.ballInHand, true); assert.equal(x.nextTurn, "B");
  assert.match(x.reason, /Bi cái/);
});
test("lastShotResult: group assignment reported", () => {
  const r = room();
  pot(r, [2]);
  T.finishShot(null, r, 2, [2], true);
  assert.deepEqual(r.lastShotResult.assignedGroups, { A: "solid", B: "stripe" });
  assert.equal(r.lastShotResult.keptTurn, true);
});

// Physics: pockets
function shootAt(x, y, tx, ty, speed = 40) {
  const r = room();
  for (const b of r.balls) if (b.id !== 0) { b.pocketed = true; }
  const c = r.balls[0]; c.x = x; c.y = y;
  const a = Math.atan2(ty - y, tx - x);
  c.vx = Math.cos(a) * speed; c.vy = Math.sin(a) * speed;
  return T.simulateShot(r);
}
test("straight into corner -> pocketed", () => assert.ok(shootAt(20, 20, 0, 0).pocketed.includes(0)));
test("straight into side -> pocketed", () => assert.ok(shootAt(50, 25, 50, -1).pocketed.includes(0)));
test("rolling along rail into corner -> pocketed", () => assert.ok(shootAt(30, 1.2, 0, 1.2).pocketed.includes(0)));
test("ball rolling parallel to rail passes side pocket (not dropped in side)", () => {
  const res = shootAt(20, 1.6, 80, 1.6, 60);
  assert.ok(!res.events.some((e) => e.type === "pocket" && e.pocket === 1));
});
test("ball never escapes table (random shots)", () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 300; i++) {
    const r = room();
    for (const b of r.balls) if (b.id !== 0) b.pocketed = true;
    const c = r.balls[0]; c.x = 5 + rnd() * 90; c.y = 5 + rnd() * 40;
    const a = rnd() * Math.PI * 2; c.vx = Math.cos(a) * 130; c.vy = Math.sin(a) * 130;
    T.simulateShot(r);
    if (!c.pocketed) assert.ok(c.x > 0 && c.x < 100 && c.y > 0 && c.y < 50, `escaped ${c.x},${c.y}`);
  }
});
test("shot at angle θ stays on the ray (<0.05in) until first collision", () => {
  for (const th of [0.123, 1.0, 2.5, -0.7, 3.9]) {
    const r = room();
    for (const b of r.balls) if (b.id !== 0) b.pocketed = true;
    const c = r.balls[0]; c.x = 50; c.y = 25;
    T.applyShot(r, th, 0.6);
    const res = T.simulateShot(r);
    const dx = Math.cos(th), dy = Math.sin(th);
    const ci = res.ids.indexOf(0);
    const firstCush = res.events.find((e) => e.type === "cushion");
    const lastF = firstCush ? firstCush.f - 1 : res.frames.length - 1;
    for (let f = 0; f <= lastF; f++) {
      const x = res.frames[f][ci * 6] / 100 - 50, y = res.frames[f][ci * 6 + 1] / 100 - 25;
      assert.ok(Math.abs(x * dy - y * dx) < 0.05, `θ=${th} frame ${f} off ray`);
    }
  }
});
test("cut shot: object ball leaves along ghost-ball line of centres (<3.5°, incl. cut-induced throw)", () => {
  const r = room();
  for (const b of r.balls) if (b.id !== 0 && b.id !== 5) b.pocketed = true;
  const c = r.balls[0]; c.x = 20; c.y = 25;
  const o = r.balls.find((b) => b.id === 5); o.x = 60; o.y = 27.5;
  const th = Math.atan2(2.5 - 1.2, 40);
  // analytic ghost ball
  const dx = Math.cos(th), dy = Math.sin(th);
  const ox = o.x - c.x, oy = o.y - c.y, proj = ox * dx + oy * dy;
  const perp = Math.hypot(ox - dx * proj, oy - dy * proj);
  const t = proj - Math.sqrt(4 * 1.125 * 1.125 - perp * perp);
  const gx = c.x + dx * t, gy = c.y + dy * t;
  const expect = Math.atan2(o.y - gy, o.x - gx);
  T.applyShot(r, th, 0.8);
  let got = null;
  // step manually until o moves
  const res = T.simulateShot(r);
  const oi = res.ids.indexOf(5);
  for (let f = 1; f < res.frames.length; f++) {
    const x = res.frames[f][oi * 6] / 100, y = res.frames[f][oi * 6 + 1] / 100;
    if (Math.hypot(x - 60, y - 27.5) > 3) { got = Math.atan2(y - 27.5, x - 60); break; }
  }
  assert.ok(got != null && Math.abs(got - expect) < (3.5 * Math.PI) / 180, `got ${got} expect ${expect}`);
});
test("ball-in-hand placement validation", () => {
  const r = room();
  assert.equal(T.isValidCuePlacement(r, 20, 25), true);
  assert.equal(T.isValidCuePlacement(r, 0.5, 25), false);
  const b1 = r.balls.find((b) => b.id === 1);
  assert.equal(T.isValidCuePlacement(r, b1.x + 1, b1.y), false);
});
// ---- Spin
function lone(ids) {
  const r = room();
  for (const b of r.balls) if (!ids.includes(b.id)) b.pocketed = true;
  return r;
}
function straightShot(spinB, power = 0.5) {
  const r = lone([0, 5]);
  const c = r.balls[0]; c.x = 30; c.y = 25;
  const o = r.balls.find((b) => b.id === 5); o.x = 42; o.y = 25;
  T.applyShot(r, 0, power, { a: 0, b: spinB });
  T.simulateShot(r);
  return { cue: c, contactX: 42 - 2 * T.BALL_R };
}
test("stun (centre ball, short distance): cue stops near contact point", () => {
  const { cue, contactX } = straightShot(-0.12);
  assert.ok(Math.abs(cue.x - contactX) < 4, `cue x ${cue.x} contact ${contactX}`);
});
test("draw: cue ball comes back", () => {
  const { cue, contactX } = straightShot(-0.45);
  assert.ok(cue.x < contactX - 8, `cue x ${cue.x}`);
});
test("follow: cue ball follows forward", () => {
  const { cue, contactX } = straightShot(0.45);
  assert.ok(cue.x > contactX + 8, `cue x ${cue.x}`);
});
test("side spin changes cushion rebound (right english -> rebounds to shooter's right)", () => {
  const vyAfter = (a) => {
    const r = lone([0]);
    const c = r.balls[0]; c.x = 80; c.y = 25;
    T.applyShot(r, 0, 0.4, { a, b: 0.2 });
    const res = T.simulateShot(r);
    const ci = res.ids.indexOf(0);
    const ev = res.events.find((e) => e.type === "cushion");
    const f = res.frames[Math.min(res.frames.length - 1, ev.f + 8)];
    return f[ci * 6 + 1] / 100 - 25;
  };
  const right = vyAfter(0.45), left = vyAfter(-0.45), centre = vyAfter(0);
  // shooting +x, shooter's right is +y
  assert.ok(right > centre + 0.3 && left < centre - 0.3, `right ${right} centre ${centre} left ${left}`);
});
test("stun cut shot: cue leaves along tangent line (within 4°)", () => {
  const r = lone([0, 5]);
  const c = r.balls[0]; c.x = 30; c.y = 25;
  const o = r.balls.find((b) => b.id === 5); o.x = 38; o.y = 26.2;
  const th = 0;
  const R = T.BALL_R;
  const perp = 1.2, proj = 8 - Math.sqrt(4 * R * R - perp * perp);
  const gx = 30 + proj, gy = 25;
  const nAng = Math.atan2(26.2 - gy, 38 - gx);
  const tang = nAng - Math.PI / 2; // tangent on the far side from object ball
  T.applyShot(r, th, 0.5, { a: 0, b: -0.15 });
  const res = T.simulateShot(r);
  const ci = res.ids.indexOf(0);
  const hit = res.events.find((e) => e.type === "hit");
  const f0 = res.frames[hit.f + 1], f1 = res.frames[hit.f + 3];
  const dir = Math.atan2(f1[ci * 6 + 1] - f0[ci * 6 + 1], f1[ci * 6] - f0[ci * 6]);
  let d = Math.abs(dir - tang); if (d > Math.PI) d = 2 * Math.PI - d;
  assert.ok(d < (4 * Math.PI) / 180, `dir ${dir} tangent ${tang}`);
});
test("squirt: right english deflects cue ball slightly left (≤2°)", () => {
  const r = lone([0]);
  const c = r.balls[0]; c.x = 20; c.y = 25;
  T.applyShot(r, 0, 0.5, { a: 0.5, b: 0 });
  const ang = Math.atan2(c.vy, c.vx) * 180 / Math.PI;
  assert.ok(ang < 0 && ang > -2, `ang ${ang}`);
});
test("tip offset clamped to miscue limit 0.5R", () => {
  const s = T.clampSpin({ a: 1, b: 1 });
  assert.ok(Math.abs(Math.hypot(s.a, s.b) - 0.5) < 1e-9);
  assert.deepEqual(T.clampSpin({ a: "x", b: null }), { a: 0, b: 0 });
});
console.log(`\n${pass} tests passed`);
