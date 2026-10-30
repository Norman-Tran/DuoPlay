const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { registerChess } = require("./chess-server");
const { registerMines } = require("./mines-server");
const { registerPool } = require("./pool-server");
const { registerWordle } = require("./wordle-server");
const { registerDomino } = require("./domino-server");
const { registerUno } = require("./uno-server");
const { registerGo } = require("./go-server");
const { installSecurity, originAllowed, ack } = require("./security");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3100", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/** @typedef {"X"|"O"|null} Cell */
/**
 * @typedef {{
 *   code: string,
 *   hostId: string|null,
 *   guestId: string|null,
 *   hostReady: boolean,
 *   guestReady: boolean,
 *   size: number,
 *   board: Cell[][],
 *   turn: "X"|"O",
 *   winner: "X"|"O"|"draw"|null,
 *   createdAt: number,
 *   turnDeadline: number|null,
 *   turnTimer: NodeJS.Timeout|null,
 *   lastMoveAuto: boolean,
 *   winningLine: {row:number,col:number}[]|null,
 *   scoreX: number,
 *   scoreO: number,
 * }} Room
 */

const ALLOWED_SIZES = [15, 30, 45];
const DEFAULT_SIZE = 15;
const WIN = 5;
const TURN_MS = 45_000;

/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {import("socket.io").Server|null} */
let ioRef = null;

function normalizeSize(size) {
  const n = Number(size);
  return ALLOWED_SIZES.includes(n) ? n : DEFAULT_SIZE;
}

function emptyBoard(size) {
  const s = normalizeSize(size);
  return Array.from({ length: s }, () => Array(s).fill(null));
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function boardSize(board) {
  return board.length;
}

/** Collect same-mark cells on a ray (not including origin). */
function collectRay(board, r, c, dr, dc, mark) {
  /** @type {{row:number,col:number}[]} */
  const cells = [];
  const size = boardSize(board);
  let rr = r + dr;
  let cc = c + dc;
  while (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr][cc] === mark) {
    cells.push({ row: rr, col: cc });
    rr += dr;
    cc += dc;
  }
  return cells;
}

/**
 * Cell just outside a segment end.
 * Blocked = off-board (edge) OR opponent piece.
 * Open = in-bounds empty cell.
 */
function endBlocked(board, r, c, mark) {
  const size = boardSize(board);
  if (r < 0 || r >= size || c < 0 || c >= size) return true;
  const cell = board[r][c];
  if (cell === null) return false;
  return cell !== mark;
}

/**
 * Vietnamese Caro "chan 2 dau":
 * Contiguous run of >=5 same marks wins ONLY if NOT blocked on BOTH ends.
 * An end is blocked by opponent stone OR board edge.
 * Open end = empty in-bounds cell. One-side-open or fully-open 5+ wins.
 * Both ends blocked => not a win (continue playing).
 * @returns {{row:number,col:number}[]|null}
 */
function findWinningLine(board, r, c, mark) {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  const size = boardSize(board);
  for (const [dr, dc] of dirs) {
    const forward = collectRay(board, r, c, dr, dc, mark);
    const backward = collectRay(board, r, c, -dr, -dc, mark);
    const line = [...backward.reverse(), { row: r, col: c }, ...forward];
    if (line.length < WIN) continue;

    const start = line[0];
    const end = line[line.length - 1];
    const beforeR = start.row - dr;
    const beforeC = start.col - dc;
    const afterR = end.row + dr;
    const afterC = end.col + dc;
    const blockedBefore = endBlocked(board, beforeR, beforeC, mark);
    const blockedAfter = endBlocked(board, afterR, afterC, mark);

    // Win only if at least one end is open (not both blocked)
    if (!(blockedBefore && blockedAfter)) {
      return line;
    }
  }
  return null;
}

function boardFull(board) {
  return board.every((row) => row.every((cell) => cell !== null));
}

function emptyCells(board) {
  /** @type {{row:number,col:number}[]} */
  const cells = [];
  const size = boardSize(board);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!board[r][c]) cells.push({ row: r, col: c });
    }
  }
  return cells;
}

function resetSessionScore(room) {
  room.scoreX = 0;
  room.scoreO = 0;
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnDeadline = null;
}

function bothSeated(room) {
  return Boolean(room.hostId && room.guestId);
}

function bothReady(room) {
  return bothSeated(room) && room.hostReady && room.guestReady;
}

function gameActive(room) {
  return bothReady(room) && !room.winner;
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  if (!gameActive(room)) return;

  room.turnDeadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    onTurnTimeout(room);
  }, TURN_MS);
}

/**
 * @param {Room} room
 * @param {number} row
 * @param {number} col
 * @param {"X"|"O"} mark
 * @param {boolean} auto
 */
function applyMove(room, row, col, mark, auto) {
  if (room.winner) return false;
  if (!gameActive(room)) return false;
  if (mark !== room.turn) return false;
  const size = boardSize(room.board);
  if (row < 0 || row >= size || col < 0 || col >= size || room.board[row][col]) return false;

  room.board[row][col] = mark;
  room.lastMoveAuto = auto;

  const line = findWinningLine(room.board, row, col, mark);
  if (line) {
    room.winner = mark;
    room.winningLine = line;
    if (mark === "X") room.scoreX += 1;
    else room.scoreO += 1;
    clearTurnTimer(room);
  } else if (boardFull(room.board)) {
    room.winner = "draw";
    room.winningLine = null;
    clearTurnTimer(room);
  } else {
    room.turn = mark === "X" ? "O" : "X";
    startTurnTimer(room);
  }
  return true;
}

function onTurnTimeout(room) {
  if (!gameActive(room)) return;
  const mark = room.turn;
  const cells = emptyCells(room.board);
  if (cells.length === 0) {
    room.winner = "draw";
    room.winningLine = null;
    clearTurnTimer(room);
    emitRoom(room);
    return;
  }
  const pick = cells[Math.floor(Math.random() * cells.length)];
  applyMove(room, pick.row, pick.col, mark, true);
  emitRoom(room);
}

function emitRoom(room) {
  if (!ioRef) return;
  ioRef.to(room.code).emit("room:update", publicRoom(room));
}

function publicRoom(room) {
  return {
    code: room.code,
    size: room.size,
    hostSeated: Boolean(room.hostId),
    guestSeated: Boolean(room.guestId),
    hostReady: room.hostReady,
    guestReady: room.guestReady,
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    turnDeadline: room.turnDeadline,
    turnLimitSec: TURN_MS / 1000,
    lastMoveAuto: room.lastMoveAuto,
    winningLine: room.winningLine,
    score: { X: room.scoreX, O: room.scoreO },
    allowedSizes: ALLOWED_SIZES,
    players: {
      host: room.hostId ? "X" : null,
      guest: room.guestId ? "O" : null,
    },
  };
}

function newRoom(hostId, size) {
  const s = normalizeSize(size);
  return {
    code: makeCode(),
    hostId,
    guestId: null,
    hostReady: false,
    guestReady: false,
    size: s,
    board: emptyBoard(s),
    turn: "X",
    winner: null,
    createdAt: Date.now(),
    turnDeadline: null,
    turnTimer: null,
    lastMoveAuto: false,
    winningLine: null,
    scoreX: 0,
    scoreO: 0,
  };
}

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end("internal error");
    }
  });

  const io = new Server(httpServer, {
    path: "/api/socketio",
    addTrailingSlash: false,
    maxHttpBufferSize: 16 * 1024, // socket.io default is 1 MB
    // same-origin only (blocks cross-site WebSocket hijacking); extra origins via ALLOWED_ORIGINS
    allowRequest: (req, cb) => cb(null, originAllowed(req)),
    cors: { origin: false },
  });
  ioRef = io;
  // must run before game handlers are registered so its packet middleware sees every event
  installSecurity(io, [
    rooms,
    require("./chess-server").rooms,
    require("./mines-server").rooms,
    require("./pool-server").rooms,
    require("./wordle-server").rooms,
    require("./domino-server").rooms,
    require("./uno-server").rooms,
    require("./go-server").rooms,
  ]);
  registerChess(io);
  registerMines(io);
  registerPool(io);
  registerWordle(io);
  registerDomino(io);
  registerUno(io);
  registerGo(io);

  io.on("connection", (socket) => {
    socket.on("room:create", (payload, cb) => {
      // allow (cb) or ({ size }, cb)
      let size = DEFAULT_SIZE;
      let callback = cb;
      if (typeof payload === "function") {
        callback = payload;
      } else if (payload && typeof payload === "object") {
        size = payload.size;
      }
      const room = newRoom(socket.id, size);
      rooms.set(room.code, room);
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.seat = "host";
      ack(callback)({ ok: true, seat: "host", mark: "X", room: publicRoom(room) });
    });

    socket.on("room:join", (code, cb) => {
      const normalized = String(code || "").trim().toUpperCase();
      const room = rooms.get(normalized);
      if (!room) {
        ack(cb)({ ok: false, error: "Không tìm thấy phòng." });
        return;
      }
      if (room.guestId && room.guestId !== socket.id) {
        ack(cb)({ ok: false, error: "Phòng đã đủ 2 người." });
        return;
      }
      // rejoin as host if host left
      if (!room.hostId && room.guestId !== socket.id) {
        room.hostId = socket.id;
        room.hostReady = false;
        socket.join(normalized);
        socket.data.roomCode = normalized;
        socket.data.seat = "host";
        clearTurnTimer(room);
        const payload = { ok: true, seat: "host", mark: "X", room: publicRoom(room) };
        ack(cb)(payload);
        emitRoom(room);
        return;
      }
      room.guestId = socket.id;
      room.guestReady = false;
      socket.join(normalized);
      socket.data.roomCode = normalized;
      socket.data.seat = "guest";
      clearTurnTimer(room);
      const payload = { ok: true, seat: "guest", mark: "O", room: publicRoom(room) };
      ack(cb)(payload);
      emitRoom(room);
    });

    socket.on("room:state", (cb) => {
      const code = socket.data.roomCode;
      const room = code ? rooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = socket.id === room.hostId ? "host" : socket.id === room.guestId ? "guest" : null;
      const mark = seat === "host" ? "X" : seat === "guest" ? "O" : null;
      ack(cb)({ ok: true, seat, mark, room: publicRoom(room) });
    });

    socket.on("room:ready", (ready, cb) => {
      const code = socket.data.roomCode;
      const room = code ? rooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (room.winner) {
        ack(cb)({ ok: false, error: "Ván đã kết thúc. Hãy chơi lại." });
        return;
      }
      const seat = socket.id === room.hostId ? "host" : socket.id === room.guestId ? "guest" : null;
      if (!seat) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      const next = Boolean(ready);
      if (seat === "host") room.hostReady = next;
      else room.guestReady = next;

      if (bothReady(room)) {
        // Start / resume timer for current turn when both become ready
        if (!room.turnDeadline) startTurnTimer(room);
      } else {
        clearTurnTimer(room);
      }
      emitRoom(room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("caro:move", (payload, cb) => {
      const { row, col } = payload && typeof payload === "object" ? payload : {};
      const code = socket.data.roomCode;
      const room = code ? rooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const mark = socket.id === room.hostId ? "X" : socket.id === room.guestId ? "O" : null;
      if (!mark) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (!bothReady(room)) {
        ack(cb)({ ok: false, error: "Chờ cả hai sẵn sàng (Ready)." });
        return;
      }
      const ok = applyMove(room, row, col, mark, false);
      if (!ok) {
        ack(cb)({
          ok: false,
          error: room.winner
            ? "Ván đã kết thúc."
            : "Nước đi không hợp lệ."
        });
        return;
      }
      emitRoom(room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("caro:rematch", (payload, cb) => {
      let size;
      let callback = cb;
      if (typeof payload === "function") {
        callback = payload;
      } else if (payload && typeof payload === "object") {
        size = payload.size;
      }
      const code = socket.data.roomCode;
      const room = code ? rooms.get(code) : null;
      if (!room) {
        ack(callback)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      // Only host may change size on rematch; guests keep current size
      if (socket.id === room.hostId && size != null) {
        room.size = normalizeSize(size);
      }
      clearTurnTimer(room);
      room.board = emptyBoard(room.size);
      room.turn = "X";
      room.winner = null;
      room.lastMoveAuto = false;
      room.winningLine = null;
      room.hostReady = false;
      room.guestReady = false;
      emitRoom(room);
      ack(callback)({ ok: true, room: publicRoom(room) });
    });

    socket.on("caro:react", (emoji, cb) => {
      const code = socket.data.roomCode;
      const room = code ? rooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = socket.id === room.hostId ? "host" : socket.id === room.guestId ? "guest" : null;
      if (!seat) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      const allowed = ["thumbsup", "laugh", "wow", "fire", "cry", "party", "clap", "heart"];
      const pick = allowed.includes(emoji) ? emoji : null;
      if (!pick) {
        ack(cb)({ ok: false, error: "Emoji không hợp lệ." });
        return;
      }
      const mark = seat === "host" ? "X" : "O";
      io.to(code).emit("caro:reaction", {
        emoji: pick,
        seat,
        mark,
        at: Date.now(),
      });
      ack(cb)({ ok: true });
    });

    socket.on("disconnect", () => {
      const code = socket.data.roomCode;
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      if (room.hostId === socket.id) {
        room.hostId = null;
        room.hostReady = false;
      }
      if (room.guestId === socket.id) {
        room.guestId = null;
        room.guestReady = false;
      }
      // Session scoreboard only while both stay; leave => forget scores
      resetSessionScore(room);
      if (!room.hostId && !room.guestId) {
        clearTurnTimer(room);
        rooms.delete(code);
      } else {
        clearTurnTimer(room);
        io.to(code).emit("room:update", publicRoom(room));
        io.to(code).emit("room:peer-left", { seat: socket.data.seat });
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`> DuoPlay ready on http://${hostname}:${port}`);
  });
});