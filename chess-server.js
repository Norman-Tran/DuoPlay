const { ack } = require("./security");
const { Chess } = require("chess.js");

/**
 * Time controls (FIDE Laws of Chess, Article 6 + Fischer increment).
 * Convention (lichess): each side's clock only starts after that side's first
 * move — i.e. no clock runs until White has moved, and White's clock starts
 * after Black's first move. From then on the side to move consumes its own
 * remaining time; after completing a move, the increment is added (FIDE 6.x,
 * "increment" mode). Flag fall (FIDE 6.9): the player whose time runs out
 * loses, unless the opponent cannot checkmate by any series of legal moves,
 * in which case the game is drawn.
 */
const TIME_CONTROLS = {
  "1+0": { baseMs: 60_000, incMs: 0, label: "Bullet 1+0" },
  "2+1": { baseMs: 120_000, incMs: 1000, label: "Bullet 2+1" },
  "3+0": { baseMs: 180_000, incMs: 0, label: "Blitz 3+0" },
  "3+2": { baseMs: 180_000, incMs: 2000, label: "Blitz 3+2" },
  "5+0": { baseMs: 300_000, incMs: 0, label: "Blitz 5+0" },
  "5+3": { baseMs: 300_000, incMs: 3000, label: "Blitz 5+3" },
  "10+0": { baseMs: 600_000, incMs: 0, label: "Rapid 10+0" },
  "10+5": { baseMs: 600_000, incMs: 5000, label: "Rapid 10+5" },
  "15+10": { baseMs: 900_000, incMs: 10_000, label: "Rapid 15+10" },
  "30+0": { baseMs: 1_800_000, incMs: 0, label: "Classical 30+0" },
  unlimited: { baseMs: 0, incMs: 0, label: "Không giới hạn" },
};
const DEFAULT_TC = "10+0";
/** @type {Map<string, any>} */
const chessRooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (chessRooms.has(code)) return makeCode();
  return code;
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function isUnlimited(room) {
  return room.tcKey === "unlimited";
}

function resetClock(room) {
  const tc = TIME_CONTROLS[room.tcKey];
  room.clock = { white: tc.baseMs, black: tc.baseMs };
  room.turnStart = null;
}

/** Clock runs only once both sides have made their first move (lichess convention). */
function clockShouldRun(room) {
  return !isUnlimited(room) && gameActive(room) && room.game.history().length >= 2;
}

/** Deduct elapsed time for the side to move and stop its running segment. */
function settleClock(room, now = Date.now()) {
  if (room.turnStart == null) return;
  const side = currentMark(room);
  room.clock[side] = Math.max(0, room.clock[side] - (now - room.turnStart));
  room.turnStart = null;
}

/** Hand-written FIDE 6.9 helper: can `color` checkmate by any series of legal moves? */
function hasMatingMaterial(game, color) {
  const c = color === "white" ? "w" : "b";
  let minors = 0;
  for (const rank of game.board()) {
    for (const sq of rank) {
      if (!sq || sq.color !== c) continue;
      if (sq.type === "p" || sq.type === "r" || sq.type === "q") return true;
      if (sq.type === "b" || sq.type === "n") minors += 1;
    }
  }
  // Lone king, or K+B / K+N only: cannot mate.
  return minors >= 2;
}

function onFlag(io, room, now = Date.now()) {
  if (!gameActive(room) || isUnlimited(room)) return;
  settleClock(room, now);
  const loser = currentMark(room);
  if (room.clock[loser] > 0) {
    startTurnTimer(io, room, now);
    return;
  }
  const opp = loser === "white" ? "black" : "white";
  room.turnTimer && clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.drawOfferFrom = null;
  if (hasMatingMaterial(room.game, opp)) {
    room.winner = opp;
    room.endReason = "timeout";
    if (opp === "white") room.scoreWhite += 1;
    else room.scoreBlack += 1;
  } else {
    room.winner = "draw";
    room.endReason = "timeout-draw";
  }
  if (io) emitRoom(io, room);
}

function resetSessionScore(room) {
  room.scoreWhite = 0;
  room.scoreBlack = 0;
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

function currentMark(room) {
  return room.game.turn() === "w" ? "white" : "black";
}

function markForSocket(room, socketId) {
  if (socketId === room.hostId) return "white";
  if (socketId === room.guestId) return "black";
  return null;
}

function publicBoard(game) {
  return game.board().map((rank) =>
    rank.map((sq) => (sq ? { color: sq.color, type: sq.type } : null)),
  );
}

/**
 * Classify automatic game-over from chess.js position.
 * @returns {{ winner: "white"|"black"|"draw", endReason: string }|null}
 */
function classifyOutcome(game) {
  if (game.isCheckmate()) {
    return {
      winner: game.turn() === "w" ? "black" : "white",
      endReason: "checkmate",
    };
  }
  if (game.isStalemate()) {
    return { winner: "draw", endReason: "stalemate" };
  }
  if (game.isThreefoldRepetition()) {
    return { winner: "draw", endReason: "threefold" };
  }
  if (typeof game.isDrawByFiftyMoves === "function" && game.isDrawByFiftyMoves()) {
    return { winner: "draw", endReason: "fifty" };
  }
  if (game.isInsufficientMaterial()) {
    return { winner: "draw", endReason: "insufficient" };
  }
  if (game.isDraw()) {
    return { winner: "draw", endReason: "fifty" };
  }
  return null;
}

function publicRoom(room) {
  const game = room.game;
  const winner = room.winner;
  return {
    code: room.code,
    hostSeated: Boolean(room.hostId),
    guestSeated: Boolean(room.guestId),
    hostReady: room.hostReady,
    guestReady: room.guestReady,
    fen: game.fen(),
    board: publicBoard(game),
    turn: currentMark(room),
    winner,
    endReason: room.endReason,
    drawOfferFrom: room.drawOfferFrom,
    inCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isStalemate: game.isStalemate(),
    isDraw: game.isDraw() || winner === "draw",
    timeControl: { key: room.tcKey, ...TIME_CONTROLS[room.tcKey] },
    clock: {
      white: room.clock.white,
      black: room.clock.black,
      running: room.turnStart != null ? currentMark(room) : null,
      // elapsed since turn start, so clients don't depend on clock sync
      elapsedMs: room.turnStart != null ? Date.now() - room.turnStart : 0,
    },
    history: room.game.history({ verbose: true }).map((m) => ({
      san: m.san,
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured || null,
      promotion: m.promotion || null,
    })),
    lastMove: room.lastMove,
    lastMoveAuto: room.lastMoveAuto,
    score: { white: room.scoreWhite, black: room.scoreBlack },
    players: {
      host: room.hostId ? "white" : null,
      guest: room.guestId ? "black" : null,
    },
  };
}

function emitRoom(io, room) {
  io.to(room.code).emit("chess:update", publicRoom(room));
}

function startTurnTimer(io, room, now = Date.now()) {
  clearTurnTimer(room);
  room.turnStart = null;
  if (!clockShouldRun(room)) return;
  room.turnStart = now;
  const side = currentMark(room);
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    onFlag(io, room);
  }, room.clock[side] + 20);
  if (room.turnTimer.unref) room.turnTimer.unref();
}

/** Called after a legal move by `mover`: deduct time, add increment. Returns false on flag. */
function chargeMove(room, mover, now = Date.now()) {
  if (isUnlimited(room)) return true;
  if (room.turnStart != null) {
    const left = room.clock[mover] - (now - room.turnStart);
    room.turnStart = null;
    if (left <= 0) {
      room.clock[mover] = 0;
      return false;
    }
    room.clock[mover] = left + TIME_CONTROLS[room.tcKey].incMs;
  }
  return true;
}

function applyOutcome(room) {
  const outcome = classifyOutcome(room.game);
  if (!outcome) return false;
  room.winner = outcome.winner;
  room.endReason = outcome.endReason;
  room.drawOfferFrom = null;
  if (outcome.winner === "white") room.scoreWhite += 1;
  else if (outcome.winner === "black") room.scoreBlack += 1;
  room.turnStart = null;
  clearTurnTimer(room);
  return true;
}

function endByResign(room, resigningColor) {
  settleClock(room);
  const winner = resigningColor === "white" ? "black" : "white";
  room.winner = winner;
  room.endReason = "resign";
  room.drawOfferFrom = null;
  if (winner === "white") room.scoreWhite += 1;
  else room.scoreBlack += 1;
  clearTurnTimer(room);
}

function endByAgreement(room) {
  settleClock(room);
  room.winner = "draw";
  room.endReason = "agreement";
  room.drawOfferFrom = null;
  clearTurnTimer(room);
}

function newRoom(hostId, tcKey = DEFAULT_TC) {
  const room = {
    tcKey: TIME_CONTROLS[tcKey] ? tcKey : DEFAULT_TC,
    clock: null,
    turnStart: null,
    code: makeCode(),
    hostId,
    guestId: null,
    hostReady: false,
    guestReady: false,
    game: new Chess(),
    winner: null,
    endReason: null,
    drawOfferFrom: null,
    turnDeadline: null,
    turnTimer: null,
    lastMove: null,
    lastMoveAuto: false,
    scoreWhite: 0,
    scoreBlack: 0,
  };
  resetClock(room);
  return room;
}

/** Apply a move for the side to move (shared by socket handler and tests). */
function applyMove(io, room, mv, now = Date.now()) {
  const mover = currentMark(room);
  // Flag check before the move is accepted (time already ran out).
  if (!isUnlimited(room) && room.turnStart != null && room.clock[mover] - (now - room.turnStart) <= 0) {
    onFlag(io, room, now);
    return { ok: false, error: "Hết giờ." };
  }
  let moved;
  try {
    moved = room.game.move(mv);
  } catch {
    moved = null;
  }
  if (!moved) return { ok: false, error: "Nước đi không hợp lệ." };
  chargeMove(room, mover, now);
  room.lastMove = { from: moved.from, to: moved.to, san: moved.san };
  room.lastMoveAuto = false;
  room.drawOfferFrom = null;
  if (!applyOutcome(room)) startTurnTimer(io, room, now);
  return { ok: true };
}

/**
 * @param {import("socket.io").Server} io
 */
function registerChess(io) {
  io.on("connection", (socket) => {
    socket.on("chess:create", (opts, cb) => {
      if (typeof opts === "function") {
        cb = opts;
        opts = {};
      }
      const room = newRoom(socket.id, opts && opts.timeControl);
      chessRooms.set(room.code, room);
      socket.join(room.code);
      socket.data.chessCode = room.code;
      socket.data.chessSeat = "host";
      ack(cb)({ ok: true, seat: "host", color: "white", room: publicRoom(room) });
    });

    socket.on("chess:join", (code, cb) => {
      const normalized = String(code || "").trim().toUpperCase();
      const room = chessRooms.get(normalized);
      if (!room) {
        ack(cb)({ ok: false, error: "Không tìm thấy phòng." });
        return;
      }
      if (room.guestId && room.guestId !== socket.id && room.hostId !== socket.id) {
        if (room.hostId && room.guestId) {
          ack(cb)({ ok: false, error: "Phòng đã đủ 2 người." });
          return;
        }
      }
      if (!room.hostId) {
        room.hostId = socket.id;
        room.hostReady = false;
        room.drawOfferFrom = null;
        socket.join(normalized);
        socket.data.chessCode = normalized;
        socket.data.chessSeat = "host";
        settleClock(room);
        clearTurnTimer(room);
        ack(cb)({ ok: true, seat: "host", color: "white", room: publicRoom(room) });
        emitRoom(io, room);
        return;
      }
      if (room.hostId === socket.id) {
        socket.join(normalized);
        socket.data.chessCode = normalized;
        socket.data.chessSeat = "host";
        ack(cb)({ ok: true, seat: "host", color: "white", room: publicRoom(room) });
        return;
      }
      room.guestId = socket.id;
      room.guestReady = false;
      room.drawOfferFrom = null;
      socket.join(normalized);
      socket.data.chessCode = normalized;
      socket.data.chessSeat = "guest";
      settleClock(room);
      clearTurnTimer(room);
      ack(cb)({ ok: true, seat: "guest", color: "black", room: publicRoom(room) });
      emitRoom(io, room);
    });

    socket.on("chess:state", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = socket.id === room.hostId ? "host" : socket.id === room.guestId ? "guest" : null;
      const color = seat === "host" ? "white" : seat === "guest" ? "black" : null;
      ack(cb)({ ok: true, seat, color, room: publicRoom(room) });
    });

    socket.on("chess:ready", (ready, cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
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
      if (seat === "host") room.hostReady = Boolean(ready);
      else room.guestReady = Boolean(ready);

      if (bothReady(room)) {
        if (!room.turnTimer) startTurnTimer(io, room);
      } else {
        settleClock(room);
        clearTurnTimer(room);
        room.drawOfferFrom = null;
      }
      emitRoom(io, room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:moves", (from, cb) => {
      if (typeof from !== "string" || !/^[a-h][1-8]$/.test(from)) return ack(cb)({ ok: false, moves: [] });
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room || !gameActive(room)) {
        ack(cb)({ ok: false, moves: [] });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color || color !== currentMark(room)) {
        ack(cb)({ ok: false, moves: [] });
        return;
      }
      const moves = room.game.moves({ square: from, verbose: true }).map((m) => ({
        from: m.from,
        to: m.to,
        promotion: m.promotion || null,
        san: m.san,
      }));
      ack(cb)({ ok: true, moves });
    });

    socket.on("chess:move", (payload, cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!bothReady(room)) {
        ack(cb)({ ok: false, error: "Chờ cả hai sẵn sàng (Ready)." });
        return;
      }
      if (room.winner) {
        ack(cb)({ ok: false, error: "Ván đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (color !== currentMark(room)) {
        ack(cb)({ ok: false, error: "Chưa tới lượt của bạn." });
        return;
      }
      const { from, to, promotion } = payload || {};
      const res = applyMove(io, room, { from, to, promotion: promotion || "q" });
      if (!res.ok) {
        ack(cb)({ ok: false, error: res.error });
        return;
      }
      emitRoom(io, room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:resign", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!gameActive(room)) {
        ack(cb)({ ok: false, error: "Ván chưa đang chơi hoặc đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      endByResign(room, color);
      emitRoom(io, room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:draw-offer", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!gameActive(room)) {
        ack(cb)({ ok: false, error: "Ván chưa đang chơi hoặc đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      // Toggle cancel if this player already offered
      if (room.drawOfferFrom === color) {
        room.drawOfferFrom = null;
        emitRoom(io, room);
        ack(cb)({ ok: true, room: publicRoom(room), cancelled: true });
        return;
      }
      // One pending offer at a time — ignore if opponent already offered
      if (room.drawOfferFrom && room.drawOfferFrom !== color) {
        ack(cb)({ ok: false, error: "Đối thủ đang xin hòa. Hãy chấp nhận hoặc từ chối." });
        return;
      }
      room.drawOfferFrom = color;
      emitRoom(io, room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:draw-accept", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!gameActive(room)) {
        ack(cb)({ ok: false, error: "Ván chưa đang chơi hoặc đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (!room.drawOfferFrom || room.drawOfferFrom === color) {
        ack(cb)({ ok: false, error: "Không có lời xin hòa từ đối thủ." });
        return;
      }
      endByAgreement(room);
      emitRoom(io, room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:draw-decline", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!gameActive(room)) {
        ack(cb)({ ok: false, error: "Ván chưa đang chơi hoặc đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        ack(cb)({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (!room.drawOfferFrom || room.drawOfferFrom === color) {
        ack(cb)({ ok: false, error: "Không có lời xin hòa từ đối thủ." });
        return;
      }
      room.drawOfferFrom = null;
      emitRoom(io, room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:rematch", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        ack(cb)({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      clearTurnTimer(room);
      room.game = new Chess();
      room.winner = null;
      room.endReason = null;
      room.drawOfferFrom = null;
      room.lastMove = null;
      room.lastMoveAuto = false;
      resetClock(room);
      room.hostReady = false;
      room.guestReady = false;
      emitRoom(io, room);
      ack(cb)({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:react", (emoji, cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
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
      if (!allowed.includes(emoji)) {
        ack(cb)({ ok: false, error: "Emoji không hợp lệ." });
        return;
      }
      const color = seat === "host" ? "white" : "black";
      io.to(code).emit("chess:reaction", { emoji, seat, color, at: Date.now() });
      ack(cb)({ ok: true });
    });

    socket.on("disconnect", () => {
      const code = socket.data.chessCode;
      if (!code) return;
      const room = chessRooms.get(code);
      if (!room) return;
      if (room.hostId === socket.id) {
        room.hostId = null;
        room.hostReady = false;
      }
      if (room.guestId === socket.id) {
        room.guestId = null;
        room.guestReady = false;
      }
      room.drawOfferFrom = null;
      resetSessionScore(room);
      settleClock(room);
      if (!room.hostId && !room.guestId) {
        clearTurnTimer(room);
        chessRooms.delete(code);
      } else {
        clearTurnTimer(room);
        io.to(code).emit("chess:update", publicRoom(room));
        io.to(code).emit("chess:peer-left", { seat: socket.data.chessSeat });
      }
    });
  });
}

module.exports = {
  registerChess,
  rooms: chessRooms,
  TIME_CONTROLS,
  _test: { newRoom, applyMove, onFlag, hasMatingMaterial, startTurnTimer, settleClock, clearTurnTimer, publicRoom },
};
