const DIFFICULTIES = {
  easy: { id: "easy", label: "Dễ", rows: 9, cols: 9, mines: 10 },
  medium: { id: "medium", label: "Vừa", rows: 12, cols: 12, mines: 25 },
  hard: { id: "hard", label: "Khó", rows: 16, cols: 16, mines: 40 },
};

const DEFAULT_DIFF = "medium";
const COUNTDOWN_MS = 3_000;

/** @type {Map<string, any>} */
const minesRooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (minesRooms.has(code)) return makeCode();
  return code;
}

function normalizeDiff(id) {
  return DIFFICULTIES[id] ? id : DEFAULT_DIFF;
}

function emptyBoolGrid(rows, cols, fill) {
  return Array.from({ length: rows }, () => Array(cols).fill(!!fill));
}

function makePlayer(rows, cols) {
  return {
    revealed: emptyBoolGrid(rows, cols, false),
    flagged: emptyBoolGrid(rows, cols, false),
    openedSafe: 0,
    hitMine: false,
    cleared: false,
    finishedAt: null,
  };
}

function clearCountdown(room) {
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
  room.countdownEndsAt = null;
}

function bothSeated(room) {
  return Boolean(room.hostId && room.guestId);
}

function bothReady(room) {
  return bothSeated(room) && room.hostReady && room.guestReady;
}

function seatOf(room, socketId) {
  if (socketId === room.hostId) return "host";
  if (socketId === room.guestId) return "guest";
  return null;
}

function playerOf(room, seat) {
  return seat === "host" ? room.playerHost : seat === "guest" ? room.playerGuest : null;
}

function safeTotal(room) {
  return room.rows * room.cols - room.mineCount;
}

function inBounds(room, r, c) {
  return r >= 0 && r < room.rows && c >= 0 && c < room.cols;
}

function neighbors(room, r, c) {
  /** @type {{r:number,c:number}[]} */
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (inBounds(room, rr, cc)) out.push({ r: rr, c: cc });
    }
  }
  return out;
}

function adjacentMines(room, r, c) {
  let n = 0;
  for (const nb of neighbors(room, r, c)) {
    if (room.mines[nb.r][nb.c]) n += 1;
  }
  return n;
}

/** Place mines avoiding a cell and its neighbors (first-click safe). */
function placeMines(room, safeR, safeC) {
  const forbidden = new Set();
  forbidden.add(`${safeR},${safeC}`);
  for (const nb of neighbors(room, safeR, safeC)) {
    forbidden.add(`${nb.r},${nb.c}`);
  }
  /** @type {{r:number,c:number}[]} */
  const candidates = [];
  for (let r = 0; r < room.rows; r++) {
    for (let c = 0; c < room.cols; c++) {
      if (!forbidden.has(`${r},${c}`)) candidates.push({ r, c });
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }
  room.mines = emptyBoolGrid(room.rows, room.cols, false);
  const count = Math.min(room.mineCount, candidates.length);
  for (let i = 0; i < count; i++) {
    room.mines[candidates[i].r][candidates[i].c] = true;
  }
  room.minesFinalized = true;
}

function viewForPlayer(room, seat, revealAllMines) {
  const p = playerOf(room, seat);
  if (!p) return null;
  /** @type {any[][]} */
  const grid = [];
  for (let r = 0; r < room.rows; r++) {
    /** @type {any[]} */
    const row = [];
    for (let c = 0; c < room.cols; c++) {
      const isMine = room.minesFinalized && room.mines[r][c];
      if (p.revealed[r][c]) {
        if (isMine) row.push({ s: "mine" });
        else row.push({ s: "open", n: adjacentMines(room, r, c) });
      } else if (revealAllMines && isMine) {
        row.push({ s: p.flagged[r][c] ? "flag-mine" : "mine-hidden" });
      } else if (p.flagged[r][c]) {
        row.push({ s: "flag" });
      } else {
        row.push({ s: "hidden" });
      }
    }
    grid.push(row);
  }
  return grid;
}

function progressOf(room, seat) {
  const p = playerOf(room, seat);
  if (!p) return { opened: 0, flagged: 0, hitMine: false, cleared: false };
  let flagged = 0;
  for (let r = 0; r < room.rows; r++) {
    for (let c = 0; c < room.cols; c++) {
      if (p.flagged[r][c]) flagged += 1;
    }
  }
  return {
    opened: p.openedSafe,
    flagged,
    hitMine: p.hitMine,
    cleared: p.cleared,
  };
}

function publicRoom(room, forSocketId) {
  const mySeat = forSocketId ? seatOf(room, forSocketId) : null;
  const finished = room.phase === "finished";
  return {
    code: room.code,
    hostSeated: Boolean(room.hostId),
    guestSeated: Boolean(room.guestId),
    hostReady: room.hostReady,
    guestReady: room.guestReady,
    difficulty: room.difficulty,
    rows: room.rows,
    cols: room.cols,
    mineCount: room.mineCount,
    safeTotal: safeTotal(room),
    phase: room.phase,
    countdownEndsAt: room.countdownEndsAt,
    startedAt: room.startedAt,
    winner: room.winner,
    endReason: room.endReason,
    score: { host: room.scoreHost, guest: room.scoreGuest },
    difficulties: Object.values(DIFFICULTIES),
    mySeat,
    board: mySeat ? viewForPlayer(room, mySeat, finished) : null,
    me: mySeat ? progressOf(room, mySeat) : null,
    opponent: mySeat ? progressOf(room, mySeat === "host" ? "guest" : "host") : null,
    hostProgress: progressOf(room, "host"),
    guestProgress: progressOf(room, "guest"),
    elapsedMs:
      room.startedAt && (room.phase === "playing" || room.phase === "finished")
        ? (room.finishedAt || Date.now()) - room.startedAt
        : 0,
  };
}

function emitRoom(io, room) {
  for (const sid of [room.hostId, room.guestId]) {
    if (!sid) continue;
    io.to(sid).emit("mines:update", publicRoom(room, sid));
  }
}

function applyDiff(room, diffId) {
  const d = DIFFICULTIES[normalizeDiff(diffId)];
  room.difficulty = d.id;
  room.rows = d.rows;
  room.cols = d.cols;
  room.mineCount = d.mines;
  room.mines = emptyBoolGrid(d.rows, d.cols, false);
  room.minesFinalized = false;
  room.playerHost = makePlayer(d.rows, d.cols);
  room.playerGuest = makePlayer(d.rows, d.cols);
}

function resetRound(room, keepScore) {
  clearCountdown(room);
  applyDiff(room, room.difficulty);
  room.phase = "lobby";
  room.winner = null;
  room.endReason = null;
  room.startedAt = null;
  room.finishedAt = null;
  room.hostReady = false;
  room.guestReady = false;
  if (!keepScore) {
    room.scoreHost = 0;
    room.scoreGuest = 0;
  }
}

function finishGame(room, winnerSeat, endReason) {
  room.phase = "finished";
  room.winner = winnerSeat;
  room.endReason = endReason;
  room.finishedAt = Date.now();
  clearCountdown(room);
  if (winnerSeat === "host") room.scoreHost += 1;
  else if (winnerSeat === "guest") room.scoreGuest += 1;
}

function checkRaceEnd(room) {
  if (room.phase !== "playing") return;
  const host = room.playerHost;
  const guest = room.playerGuest;
  const need = safeTotal(room);

  if (host.hitMine && guest.hitMine) {
    finishGame(room, "draw", "both-mine");
    return;
  }
  if (host.hitMine) {
    finishGame(room, "guest", "mine");
    return;
  }
  if (guest.hitMine) {
    finishGame(room, "host", "mine");
    return;
  }
  if (host.openedSafe >= need && guest.openedSafe >= need) {
    if (host.finishedAt && guest.finishedAt) {
      if (host.finishedAt < guest.finishedAt) finishGame(room, "host", "clear");
      else if (guest.finishedAt < host.finishedAt) finishGame(room, "guest", "clear");
      else finishGame(room, "draw", "clear");
    } else {
      finishGame(room, "draw", "clear");
    }
    return;
  }
  if (host.openedSafe >= need) {
    host.cleared = true;
    host.finishedAt = host.finishedAt || Date.now();
    finishGame(room, "host", "clear");
    return;
  }
  if (guest.openedSafe >= need) {
    guest.cleared = true;
    guest.finishedAt = guest.finishedAt || Date.now();
    finishGame(room, "guest", "clear");
  }
}

function revealFlood(room, player, r, c) {
  if (!inBounds(room, r, c)) return;
  if (player.revealed[r][c]) return;
  if (player.flagged[r][c]) return;
  if (room.mines[r][c]) return;

  player.revealed[r][c] = true;
  player.openedSafe += 1;
  const n = adjacentMines(room, r, c);
  if (n === 0) {
    for (const nb of neighbors(room, r, c)) {
      revealFlood(room, player, nb.r, nb.c);
    }
  }
}

function startCountdown(io, room) {
  clearCountdown(room);
  room.phase = "countdown";
  room.countdownEndsAt = Date.now() + COUNTDOWN_MS;
  applyDiff(room, room.difficulty);
  room.hostReady = true;
  room.guestReady = true;
  room.winner = null;
  room.endReason = null;
  room.startedAt = null;
  room.finishedAt = null;
  emitRoom(io, room);
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;
    room.countdownEndsAt = null;
    room.phase = "playing";
    room.startedAt = Date.now();
    emitRoom(io, room);
  }, COUNTDOWN_MS);
}

function newRoom(hostId, difficulty) {
  const room = {
    code: makeCode(),
    hostId,
    guestId: null,
    hostReady: false,
    guestReady: false,
    difficulty: normalizeDiff(difficulty),
    rows: 0,
    cols: 0,
    mineCount: 0,
    mines: null,
    minesFinalized: false,
    playerHost: null,
    playerGuest: null,
    phase: "lobby",
    countdownEndsAt: null,
    countdownTimer: null,
    startedAt: null,
    finishedAt: null,
    winner: null,
    endReason: null,
    scoreHost: 0,
    scoreGuest: 0,
  };
  applyDiff(room, room.difficulty);
  return room;
}

/**
 * @param {import("socket.io").Server} io
 */
function registerMines(io) {
  io.on("connection", (socket) => {
    socket.on("mines:create", (payload, cb) => {
      let difficulty = DEFAULT_DIFF;
      let callback = cb;
      if (typeof payload === "function") {
        callback = payload;
      } else if (payload && typeof payload === "object") {
        difficulty = payload.difficulty || DEFAULT_DIFF;
      }
      const room = newRoom(socket.id, difficulty);
      minesRooms.set(room.code, room);
      socket.join(room.code);
      socket.data.minesCode = room.code;
      socket.data.minesSeat = "host";
      callback?.({ ok: true, seat: "host", room: publicRoom(room, socket.id) });
    });

    socket.on("mines:join", (code, cb) => {
      const normalized = String(code || "").trim().toUpperCase();
      const room = minesRooms.get(normalized);
      if (!room) {
        cb?.({ ok: false, error: "Không tìm thấy phòng." });
        return;
      }
      if (room.hostId === socket.id) {
        socket.join(normalized);
        socket.data.minesCode = normalized;
        socket.data.minesSeat = "host";
        cb?.({ ok: true, seat: "host", room: publicRoom(room, socket.id) });
        return;
      }
      if (room.guestId === socket.id) {
        socket.join(normalized);
        socket.data.minesCode = normalized;
        socket.data.minesSeat = "guest";
        cb?.({ ok: true, seat: "guest", room: publicRoom(room, socket.id) });
        return;
      }
      if (!room.hostId) {
        room.hostId = socket.id;
        room.hostReady = false;
        socket.join(normalized);
        socket.data.minesCode = normalized;
        socket.data.minesSeat = "host";
        clearCountdown(room);
        if (room.phase !== "finished") room.phase = "lobby";
        cb?.({ ok: true, seat: "host", room: publicRoom(room, socket.id) });
        emitRoom(io, room);
        return;
      }
      if (room.guestId && room.guestId !== socket.id) {
        cb?.({ ok: false, error: "Phòng đã đủ 2 người." });
        return;
      }
      room.guestId = socket.id;
      room.guestReady = false;
      socket.join(normalized);
      socket.data.minesCode = normalized;
      socket.data.minesSeat = "guest";
      clearCountdown(room);
      if (room.phase === "countdown" || room.phase === "playing") {
        room.phase = "lobby";
        room.hostReady = false;
        room.guestReady = false;
      }
      cb?.({ ok: true, seat: "guest", room: publicRoom(room, socket.id) });
      emitRoom(io, room);
    });

    socket.on("mines:state", (cb) => {
      const code = socket.data.minesCode;
      const room = code ? minesRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = seatOf(room, socket.id);
      cb?.({ ok: true, seat, room: publicRoom(room, socket.id) });
    });

    socket.on("mines:set-diff", (difficulty, cb) => {
      const code = socket.data.minesCode;
      const room = code ? minesRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (socket.id !== room.hostId) {
        cb?.({ ok: false, error: "Chỉ Host được đổi độ khó." });
        return;
      }
      if (room.phase === "playing" || room.phase === "countdown") {
        cb?.({ ok: false, error: "Không đổi độ khó khi đang chơi." });
        return;
      }
      applyDiff(room, difficulty);
      room.hostReady = false;
      room.guestReady = false;
      room.phase = "lobby";
      room.winner = null;
      room.endReason = null;
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room, socket.id) });
    });

    socket.on("mines:ready", (ready, cb) => {
      const code = socket.data.minesCode;
      const room = code ? minesRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (room.phase === "finished") {
        cb?.({ ok: false, error: "Ván đã kết thúc. Hãy chơi lại." });
        return;
      }
      if (room.phase === "playing" || room.phase === "countdown") {
        cb?.({ ok: false, error: "Đang trong ván." });
        return;
      }
      const seat = seatOf(room, socket.id);
      if (!seat) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (seat === "host") room.hostReady = Boolean(ready);
      else room.guestReady = Boolean(ready);

      if (bothReady(room)) {
        startCountdown(io, room);
      } else {
        clearCountdown(room);
        room.phase = "lobby";
        emitRoom(io, room);
      }
      cb?.({ ok: true, room: publicRoom(room, socket.id) });
    });

    socket.on("mines:open", ({ row, col }, cb) => {
      const code = socket.data.minesCode;
      const room = code ? minesRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (room.phase !== "playing") {
        cb?.({ ok: false, error: "Chưa bắt đầu." });
        return;
      }
      const seat = seatOf(room, socket.id);
      const player = playerOf(room, seat);
      if (!player) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (player.hitMine || player.cleared) {
        cb?.({ ok: false, error: "Bạn đã kết thúc ván." });
        return;
      }
      const r = Number(row);
      const c = Number(col);
      if (!inBounds(room, r, c)) {
        cb?.({ ok: false, error: "Ô không hợp lệ." });
        return;
      }
      if (player.flagged[r][c]) {
        cb?.({ ok: false, error: "Ô đang cắm cờ." });
        return;
      }
      if (player.revealed[r][c]) {
        cb?.({ ok: false, error: "Ô đã mở." });
        return;
      }

      if (!room.minesFinalized) {
        placeMines(room, r, c);
      }

      if (room.mines[r][c]) {
        player.revealed[r][c] = true;
        player.hitMine = true;
        player.finishedAt = Date.now();
        checkRaceEnd(room);
        emitRoom(io, room);
        cb?.({ ok: true, room: publicRoom(room, socket.id) });
        return;
      }

      revealFlood(room, player, r, c);
      if (player.openedSafe >= safeTotal(room)) {
        player.cleared = true;
        player.finishedAt = Date.now();
      }
      checkRaceEnd(room);
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room, socket.id) });
    });

    socket.on("mines:flag", ({ row, col }, cb) => {
      const code = socket.data.minesCode;
      const room = code ? minesRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (room.phase !== "playing") {
        cb?.({ ok: false, error: "Chưa bắt đầu." });
        return;
      }
      const seat = seatOf(room, socket.id);
      const player = playerOf(room, seat);
      if (!player) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (player.hitMine || player.cleared) {
        cb?.({ ok: false, error: "Bạn đã kết thúc ván." });
        return;
      }
      const r = Number(row);
      const c = Number(col);
      if (!inBounds(room, r, c)) {
        cb?.({ ok: false, error: "Ô không hợp lệ." });
        return;
      }
      if (player.revealed[r][c]) {
        cb?.({ ok: false, error: "Ô đã mở." });
        return;
      }
      player.flagged[r][c] = !player.flagged[r][c];
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room, socket.id) });
    });

    socket.on("mines:rematch", (payload, cb) => {
      let callback = cb;
      let difficulty;
      if (typeof payload === "function") {
        callback = payload;
      } else if (payload && typeof payload === "object") {
        difficulty = payload.difficulty;
      }
      const code = socket.data.minesCode;
      const room = code ? minesRooms.get(code) : null;
      if (!room) {
        callback?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (socket.id === room.hostId && difficulty) {
        room.difficulty = normalizeDiff(difficulty);
      }
      resetRound(room, true);
      emitRoom(io, room);
      callback?.({ ok: true, room: publicRoom(room, socket.id) });
    });

    socket.on("mines:react", (emoji, cb) => {
      const code = socket.data.minesCode;
      const room = code ? minesRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = seatOf(room, socket.id);
      if (!seat) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      const allowed = ["thumbsup", "laugh", "wow", "fire", "cry", "party", "clap", "heart"];
      if (!allowed.includes(emoji)) {
        cb?.({ ok: false, error: "Emoji không hợp lệ." });
        return;
      }
      io.to(code).emit("mines:reaction", { emoji, seat, at: Date.now() });
      cb?.({ ok: true });
    });

    socket.on("disconnect", () => {
      const code = socket.data.minesCode;
      if (!code) return;
      const room = minesRooms.get(code);
      if (!room) return;
      if (room.hostId === socket.id) {
        room.hostId = null;
        room.hostReady = false;
      }
      if (room.guestId === socket.id) {
        room.guestId = null;
        room.guestReady = false;
      }
      room.scoreHost = 0;
      room.scoreGuest = 0;
      clearCountdown(room);
      if (room.phase === "playing" || room.phase === "countdown") {
        room.phase = "lobby";
        room.winner = null;
        room.endReason = null;
        applyDiff(room, room.difficulty);
      }
      if (!room.hostId && !room.guestId) {
        minesRooms.delete(code);
      } else {
        io.to(code).emit("mines:peer-left", { seat: socket.data.minesSeat });
        emitRoom(io, room);
      }
    });
  });
}

module.exports = { registerMines };
