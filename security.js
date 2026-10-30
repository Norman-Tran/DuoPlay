/**
 * Socket-level hardening shared by every game module.
 *  - Origin check (same-origin by default, extra origins via ALLOWED_ORIGINS)
 *  - Per-IP concurrent connection cap
 *  - Per-socket token-bucket rate limit (all events) + stricter limit for room create/join
 *  - Payload shape validation (event name, size, depth, string length, array length)
 *  - Global room cap + periodic sweep of empty / stale / idle rooms
 * All numbers are configurable via env (see LIMITS).
 */
const num = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};
const LIMITS = {
  maxConnPerIp: num("MAX_CONN_PER_IP", 20),
  eventsPerSec: num("RATE_EVENTS_PER_SEC", 40), // sustained (pool aim relays at 20/s)
  eventBurst: num("RATE_EVENT_BURST", 80),
  roomOpsPerMin: num("RATE_ROOM_OPS_PER_MIN", 20), // create + join per socket
  createPerMinPerIp: num("RATE_CREATE_PER_MIN_IP", 10),
  maxRoomsTotal: num("MAX_ROOMS_TOTAL", 500),
  maxPayloadBytes: num("MAX_PAYLOAD_BYTES", 4096),
  maxDepth: 4,
  maxStringLen: 256,
  maxArrayLen: 64,
  emptyRoomTtlMs: num("EMPTY_ROOM_TTL_MS", 5 * 60_000),
  idleRoomTtlMs: num("IDLE_ROOM_TTL_MS", 2 * 3600_000),
  sweepEveryMs: 60_000,
};

const EVENT_RE = /^[a-z]{2,12}:[a-z][a-z-]{0,23}$/;

/** Validate a decoded payload. Returns null if ok, otherwise a reason string. */
function validateArgs(args) {
  let size = 0;
  const walk = (v, depth) => {
    if (depth > LIMITS.maxDepth) return "payload lồng quá sâu";
    if (v === null || v === undefined || typeof v === "boolean") return null;
    if (typeof v === "number") return Number.isFinite(v) ? null : "số không hợp lệ";
    if (typeof v === "string") {
      size += v.length;
      return v.length > LIMITS.maxStringLen ? "chuỗi quá dài" : null;
    }
    if (typeof v === "function") return null;
    if (Array.isArray(v)) {
      if (v.length > LIMITS.maxArrayLen) return "mảng quá dài";
      for (const x of v) { const r = walk(x, depth + 1); if (r) return r; }
      return null;
    }
    if (typeof v === "object") {
      if (Buffer.isBuffer(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return "không nhận dữ liệu nhị phân";
      const keys = Object.keys(v);
      if (keys.length > 32) return "quá nhiều trường";
      for (const k of keys) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") return "trường không hợp lệ";
        size += k.length;
        const r = walk(v[k], depth + 1);
        if (r) return r;
      }
      return null;
    }
    return "kiểu dữ liệu không hỗ trợ";
  };
  for (const a of args) {
    const r = walk(a, 0);
    if (r) return r;
  }
  return size > LIMITS.maxPayloadBytes ? "payload quá lớn" : null;
}

function bucket(rate, burst) {
  return { tokens: burst, last: Date.now(), rate, burst };
}
function take(b, now = Date.now()) {
  b.tokens = Math.min(b.burst, b.tokens + ((now - b.last) / 1000) * b.rate);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function clientIp(socket) {
  const h = socket.handshake.headers || {};
  const addr = String(socket.handshake.address || "unknown");
  // cloudflared connects from loopback and forwards the real client IP in cf-connecting-ip.
  // Only trust that header from loopback, so remote clients can't spoof it to dodge limits.
  const loopback = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  if (loopback && typeof h["cf-connecting-ip"] === "string") return h["cf-connecting-ip"].slice(0, 64);
  return addr;
}

/** Origin allow-check for the Socket.io handshake (blocks cross-site websocket hijacking). */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (tests, curl) send no Origin
  const extra = String(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return u.host === host;
  } catch {
    return false;
  }
}

function clearRoomTimers(room) {
  for (const k of ["turnTimer", "countdownTimer", "playbackTimer", "timer"]) if (room[k]) { clearTimeout(room[k]); room[k] = null; }
  if (room.game && room.game.timer) { clearTimeout(room.game.timer); room.game.timer = null; }
}

/**
 * @param {import("socket.io").Server} io
 * @param {Map<string, any>[]} roomMaps every game's room map
 */
function installSecurity(io, roomMaps, opts = {}) {
  const connPerIp = new Map();
  const createPerIp = new Map(); // ip -> bucket
  const totalRooms = () => roomMaps.reduce((a, m) => a + m.size, 0);
  const now = () => (opts.now ? opts.now() : Date.now());

  io.use((socket, next) => {
    const ip = clientIp(socket);
    const n = (connPerIp.get(ip) || 0) + 1;
    if (n > LIMITS.maxConnPerIp) return next(new Error("Quá nhiều kết nối từ địa chỉ này."));
    connPerIp.set(ip, n);
    socket.data.__ip = ip;
    socket.once("disconnect", () => {
      const c = (connPerIp.get(ip) || 1) - 1;
      if (c <= 0) connPerIp.delete(ip); else connPerIp.set(ip, c);
    });
    next();
  });

  io.on("connection", (socket) => {
    // Defence in depth: every handler registered after this point is wrapped so a malformed
    // payload that slips past validation answers ok:false instead of crashing the process.
    const origOn = socket.on.bind(socket);
    socket.on = (event, listener) => {
      if (event === "disconnect" || typeof listener !== "function") return origOn(event, listener);
      return origOn(event, (...args) => {
        try {
          return listener(...args);
        } catch (err) {
          console.error(`[security] handler ${event} threw:`, err && err.message);
          const cb = args[args.length - 1];
          if (typeof cb === "function") cb({ ok: false, error: "Yêu cầu không hợp lệ." });
        }
      });
    };
    const events = bucket(LIMITS.eventsPerSec, LIMITS.eventBurst);
    const roomOps = bucket(LIMITS.roomOpsPerMin / 60, LIMITS.roomOpsPerMin);
    socket.use((packet, next) => {
      const [event, ...args] = packet;
      const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
      const reject = (msg) => {
        if (cb) cb({ ok: false, error: msg });
        // drop silently otherwise; do not call next(err) to keep the socket alive
      };
      if (typeof event !== "string" || !EVENT_RE.test(event)) return reject("Sự kiện không hợp lệ.");
      if (!take(events)) return reject("Bạn thao tác quá nhanh, thử lại sau giây lát.");
      const bad = validateArgs(args);
      if (bad) return reject(`Dữ liệu không hợp lệ: ${bad}.`);
      const action = event.split(":")[1];
      if (action === "create" || action === "join") {
        if (!take(roomOps)) return reject("Tạo/vào phòng quá nhiều lần, thử lại sau.");
      }
      if (action === "create") {
        const ip = socket.data.__ip;
        let b = createPerIp.get(ip);
        if (!b) { b = bucket(LIMITS.createPerMinPerIp / 60, LIMITS.createPerMinPerIp); createPerIp.set(ip, b); }
        if (!take(b)) return reject("Tạo phòng quá nhiều lần, thử lại sau.");
        if (totalRooms() >= LIMITS.maxRoomsTotal) return reject("Máy chủ đang đầy phòng, thử lại sau.");
      }
      // activity tracking for idle sweep
      for (const [k, code] of Object.entries(socket.data)) {
        if (!/Code$/.test(k) || typeof code !== "string") continue;
        for (const m of roomMaps) { const r = m.get(code); if (r) r.__lastActive = now(); }
      }
      next();
    });
  });

  function sweep() {
    const t = now();
    let removed = 0;
    for (const m of roomMaps) {
      for (const [code, room] of m) {
        if (!room.__createdAt) room.__createdAt = t;
        if (!room.__lastActive) room.__lastActive = t;
        const ids = [room.hostId, room.guestId].filter(Boolean);
        const live = ids.filter((id) => io.sockets.sockets.has(id));
        const empty = live.length === 0;
        if ((empty && t - room.__lastActive > LIMITS.emptyRoomTtlMs) || t - room.__lastActive > LIMITS.idleRoomTtlMs) {
          clearRoomTimers(room);
          m.delete(code);
          io.to(code).emit("room:expired", { code });
          removed++;
        }
      }
    }
    // forget old create buckets
    for (const [ip, b] of createPerIp) if (t - b.last > 10 * 60_000) createPerIp.delete(ip);
    return removed;
  }
  const iv = setInterval(sweep, LIMITS.sweepEveryMs);
  if (iv.unref) iv.unref();
  return { sweep, stop: () => clearInterval(iv), connPerIp, createPerIp };
}

/** Safe acknowledgement: handlers call ack(cb)(...) so a non-function "callback" from a client can't throw. */
const NOOP = () => {};
const ack = (cb) => (typeof cb === "function" ? cb : NOOP);

module.exports = { ack, installSecurity, originAllowed, validateArgs, LIMITS, take, bucket };
