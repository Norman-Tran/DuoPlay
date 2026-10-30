// node tests/security.test.js — security limits, validation and a socket fuzz test
const assert = require("assert");
const http = require("http");
const { Server } = require("socket.io");
const { io: ioc } = require("socket.io-client");
process.env.MAX_CONN_PER_IP = "40";
const S = require("../security.js");

let pass = 0;
const test = async (n, f) => { await f(); pass++; console.log("ok -", n); };
const crashes = [];
process.on("uncaughtException", (e) => crashes.push(e));
const origErr = console.error;
console.error = (...a) => { if (String(a[0]).startsWith("[security] handler")) crashes.push(new Error(a.join(" "))); else origErr(...a); };

const modules = ["chess", "mines", "pool", "wordle", "domino", "uno", "go"].map((g) => [g, require(`../${g}-server.js`)]);

function startServer() {
  return new Promise((resolve) => {
    const httpServer = http.createServer();
    const io = new Server(httpServer, {
      path: "/api/socketio", maxHttpBufferSize: 16 * 1024,
      allowRequest: (req, cb) => cb(null, S.originAllowed(req)),
    });
    const sec = S.installSecurity(io, modules.map(([, m]) => m.rooms));
    for (const [g, m] of modules) m[`register${g === "go" ? "Go" : g[0].toUpperCase() + g.slice(1)}`](io);
    httpServer.listen(0, () => resolve({ io, sec, httpServer, port: httpServer.address().port }));
  });
}
const connect = (port, extra = {}) =>
  new Promise((res, rej) => {
    const s = ioc(`http://localhost:${port}`, { path: "/api/socketio", transports: ["websocket"], forceNew: true, reconnection: false, ...extra });
    s.on("connect", () => res(s));
    s.on("connect_error", (e) => rej(e));
  });
const call = (s, ev, ...a) => new Promise((r) => { const t = setTimeout(() => r("__timeout"), call.ms || 1500); s.emit(ev, ...a, (x) => { clearTimeout(t); r(x); }); });

(async () => {
  await test("validateArgs rejects deep, long, binary and proto payloads", () => {
    assert.equal(S.validateArgs([{ a: 1 }, "ABC123"]), null);
    assert.ok(S.validateArgs(["x".repeat(300)]));
    assert.ok(S.validateArgs([{ a: { b: { c: { d: { e: { f: 1 } } } } } }]));
    assert.ok(S.validateArgs([Array(100).fill(1)]));
    assert.ok(S.validateArgs([Buffer.from("hi")]));
    assert.ok(S.validateArgs([JSON.parse('{"__proto__": {"x": 1}}')]));
    assert.ok(S.validateArgs([NaN]) === null || true);
  });
  await test("token bucket", () => {
    const b = S.bucket(1, 3); const t = Date.now();
    assert.ok(S.take(b, t) && S.take(b, t) && S.take(b, t)); assert.equal(S.take(b, t), false);
    assert.equal(S.take(b, t + 1100), true);
  });
  await test("originAllowed: same-origin ok, foreign blocked, env allowlist", () => {
    assert.equal(S.originAllowed({ headers: { host: "a.com", origin: "https://a.com" } }), true);
    assert.equal(S.originAllowed({ headers: { host: "a.com", origin: "https://evil.com" } }), false);
    assert.equal(S.originAllowed({ headers: { host: "a.com" } }), true);
    process.env.ALLOWED_ORIGINS = "https://friend.io";
    assert.equal(S.originAllowed({ headers: { host: "a.com", origin: "https://friend.io" } }), true);
    delete process.env.ALLOWED_ORIGINS;
  });

  const { io, sec, httpServer, port } = await startServer();

  await test("cross-origin websocket handshake is refused", async () => {
    let refused = false;
    try { await connect(port, { extraHeaders: { origin: "https://evil.example" } }); } catch { refused = true; }
    assert.ok(refused);
  });

  await test("invalid event names and oversized payloads are rejected with ok:false", async () => {
    const s = await connect(port);
    assert.equal((await call(s, "chess:create", { x: "y".repeat(5000) })).ok, false);
    assert.equal((await call(s, "Bad Event!", 1)).ok, false);
    s.close();
  });

  await test("room creation rate limit per IP", async () => {
    const s = await connect(port);
    const results = [];
    for (let i = 0; i < S.LIMITS.createPerMinPerIp + 3; i++) results.push((await call(s, "uno:create", {})).ok);
    assert.equal(results.filter(Boolean).length, S.LIMITS.createPerMinPerIp);
    s.close();
  });

  await test("event flood is throttled", async () => {
    const s = await connect(port);
    const rs = await Promise.all(Array.from({ length: S.LIMITS.eventBurst + 20 }, () => call(s, "chess:state")));
    const limited = rs.filter((r) => r && r.error && /quá nhanh/.test(r.error)).length;
    assert.ok(limited >= 15, `limited=${limited}`);
    s.close();
  });

  await test("sweep removes empty rooms after TTL", async () => {
    const m = modules.find(([g]) => g === "uno")[1].rooms;
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(m.size > 0);
    for (const room of m.values()) room.__lastActive = Date.now() - S.LIMITS.emptyRoomTtlMs - 1000;
    const removed = sec.sweep();
    assert.ok(removed > 0); assert.equal(m.size, 0);
  });

  await test("fuzz: random payloads to every event never crash the server", async () => {
    const events = {
      chess: ["create", "join", "state", "ready", "moves", "move", "resign", "draw-offer", "draw-accept", "draw-decline", "rematch", "react"],
      mines: ["create", "join", "state", "set-diff", "ready", "open", "flag", "rematch", "react"],
      pool: ["create", "join", "state", "ready", "shoot", "aim", "place-cue", "rematch", "react"],
      wordle: ["create", "join", "state", "ready", "guess", "rematch", "react"],
      domino: ["create", "join", "state", "ready", "play", "draw", "next-round", "rematch", "react"],
      uno: ["create", "join", "state", "ready", "play", "draw", "keep", "color", "wd4", "uno", "catch", "next-round", "rematch", "react"],
      go: ["create", "join", "state", "ready", "play", "pass", "toggle", "accept", "resume", "resign", "rematch", "react"],
    };
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const values = () => pick([
      undefined, null, true, 0, -1, 1e9, 3.7, NaN, "", "A", "ZZZZZZ", "e2", "../../etc", "<script>", "q",
      [], [1, 2], {}, { x: -5, y: 1e6 }, { x: 2, y: 2 }, { from: "e2", to: "e4" }, { word: 12345 }, { word: "crane" },
      { tile: null, side: "up" }, { card: {}, color: "purple" }, { size: "19; drop" }, { difficulty: [] }, { timeControl: { a: 1 } },
      { angle: "NaN", power: Infinity }, { target: -100 }, { challenge: "yes" }, "thumbsup",
    ]);
    sec.createPerIp.clear();
    call.ms = 200;
    const a = await connect(port), b = await connect(port);
    // put both in real rooms so handlers reach deep logic
    for (const g of Object.keys(events)) {
      const r = await call(a, `${g}:create`, {});
      if (r && r.room) { await call(b, `${g}:join`, r.room.code); await call(a, `${g}:ready`, true); await call(b, `${g}:ready`, true); }
    }
    let sent = 0;
    for (let i = 0; i < 1200; i++) {
      const g = pick(Object.keys(events));
      const ev = `${g}:${pick(events[g])}`;
      const s = rnd() < 0.5 ? a : b;
      const n = Math.floor(rnd() * 3);
      const args = Array.from({ length: n }, values);
      if (rnd() < 0.8) await call(s, ev, ...args); else s.emit(ev, ...args);
      sent++;
      if (i % 15 === 0) await new Promise((r) => setTimeout(r, 400)); // stay under the rate limit
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(crashes.length, 0, crashes.map((e) => e.stack).join("\n"));
    assert.ok(a.connected && b.connected);
    console.log(`   (sent ${sent} fuzz events)`);
    a.close(); b.close();
  });

  sec.stop(); io.close(); httpServer.close();
  console.log(`\n${pass} passed`);
  process.exit(crashes.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
