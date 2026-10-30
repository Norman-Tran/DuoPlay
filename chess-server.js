const { Chess } = require("chess.js");

const TURN_MS = 60_000;
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
  room.turnDeadline = null;
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
    turnDeadline: room.turnDeadline,
    turnLimitSec: TURN_MS / 1000,
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

function startTurnTimer(io, room) {
  clearTurnTimer(room);
  if (!gameActive(room)) return;
  room.turnDeadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    onTurnTimeout(io, room);
  }, TURN_MS);
}

function randomLegalMove(game) {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

function applyOutcome(room) {
  const outcome = classifyOutcome(room.game);
  if (!outcome) return false;
  room.winner = outcome.winner;
  room.endReason = outcome.endReason;
  room.drawOfferFrom = null;
  if (outcome.winner === "white") room.scoreWhite += 1;
  else if (outcome.winner === "black") room.scoreBlack += 1;
  clearTurnTimer(room);
  return true;
}

function endByResign(room, resigningColor) {
  const winner = resigningColor === "white" ? "black" : "white";
  room.winner = winner;
  room.endReason = "resign";
  room.drawOfferFrom = null;
  if (winner === "white") room.scoreWhite += 1;
  else room.scoreBlack += 1;
  clearTurnTimer(room);
}

function endByAgreement(room) {
  room.winner = "draw";
  room.endReason = "agreement";
  room.drawOfferFrom = null;
  clearTurnTimer(room);
}

function onTurnTimeout(io, room) {
  if (!gameActive(room)) return;
  room.drawOfferFrom = null;
  const mv = randomLegalMove(room.game);
  if (!mv) {
    applyOutcome(room);
    emitRoom(io, room);
    return;
  }
  room.game.move(mv);
  room.lastMove = { from: mv.from, to: mv.to, san: mv.san };
  room.lastMoveAuto = true;
  if (!applyOutcome(room)) {
    startTurnTimer(io, room);
  }
  emitRoom(io, room);
}

function newRoom(hostId) {
  return {
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
}

/**
 * @param {import("socket.io").Server} io
 */
function registerChess(io) {
  io.on("connection", (socket) => {
    socket.on("chess:create", (cb) => {
      const room = newRoom(socket.id);
      chessRooms.set(room.code, room);
      socket.join(room.code);
      socket.data.chessCode = room.code;
      socket.data.chessSeat = "host";
      cb?.({ ok: true, seat: "host", color: "white", room: publicRoom(room) });
    });

    socket.on("chess:join", (code, cb) => {
      const normalized = String(code || "").trim().toUpperCase();
      const room = chessRooms.get(normalized);
      if (!room) {
        cb?.({ ok: false, error: "Không tìm thấy phòng." });
        return;
      }
      if (room.guestId && room.guestId !== socket.id && room.hostId !== socket.id) {
        if (room.hostId && room.guestId) {
          cb?.({ ok: false, error: "Phòng đã đủ 2 người." });
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
        clearTurnTimer(room);
        cb?.({ ok: true, seat: "host", color: "white", room: publicRoom(room) });
        emitRoom(io, room);
        return;
      }
      if (room.hostId === socket.id) {
        socket.join(normalized);
        socket.data.chessCode = normalized;
        socket.data.chessSeat = "host";
        cb?.({ ok: true, seat: "host", color: "white", room: publicRoom(room) });
        return;
      }
      room.guestId = socket.id;
      room.guestReady = false;
      room.drawOfferFrom = null;
      socket.join(normalized);
      socket.data.chessCode = normalized;
      socket.data.chessSeat = "guest";
      clearTurnTimer(room);
      cb?.({ ok: true, seat: "guest", color: "black", room: publicRoom(room) });
      emitRoom(io, room);
    });

    socket.on("chess:state", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = socket.id === room.hostId ? "host" : socket.id === room.guestId ? "guest" : null;
      const color = seat === "host" ? "white" : seat === "guest" ? "black" : null;
      cb?.({ ok: true, seat, color, room: publicRoom(room) });
    });

    socket.on("chess:ready", (ready, cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (room.winner) {
        cb?.({ ok: false, error: "Ván đã kết thúc. Hãy chơi lại." });
        return;
      }
      const seat = socket.id === room.hostId ? "host" : socket.id === room.guestId ? "guest" : null;
      if (!seat) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (seat === "host") room.hostReady = Boolean(ready);
      else room.guestReady = Boolean(ready);

      if (bothReady(room)) {
        if (!room.turnDeadline) startTurnTimer(io, room);
      } else {
        clearTurnTimer(room);
        room.drawOfferFrom = null;
      }
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:moves", (from, cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room || !gameActive(room)) {
        cb?.({ ok: false, moves: [] });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color || color !== currentMark(room)) {
        cb?.({ ok: false, moves: [] });
        return;
      }
      const moves = room.game.moves({ square: from, verbose: true }).map((m) => ({
        from: m.from,
        to: m.to,
        promotion: m.promotion || null,
        san: m.san,
      }));
      cb?.({ ok: true, moves });
    });

    socket.on("chess:move", (payload, cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!bothReady(room)) {
        cb?.({ ok: false, error: "Chờ cả hai sẵn sàng (Ready)." });
        return;
      }
      if (room.winner) {
        cb?.({ ok: false, error: "Ván đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (color !== currentMark(room)) {
        cb?.({ ok: false, error: "Chưa tới lượt của bạn." });
        return;
      }
      const { from, to, promotion } = payload || {};
      let moved;
      try {
        moved = room.game.move({
          from,
          to,
          promotion: promotion || "q",
        });
      } catch {
        moved = null;
      }
      if (!moved) {
        cb?.({ ok: false, error: "Nước đi không hợp lệ." });
        return;
      }
      room.lastMove = { from: moved.from, to: moved.to, san: moved.san };
      room.lastMoveAuto = false;
      room.drawOfferFrom = null;
      if (!applyOutcome(room)) {
        startTurnTimer(io, room);
      }
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:resign", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!gameActive(room)) {
        cb?.({ ok: false, error: "Ván chưa đang chơi hoặc đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      endByResign(room, color);
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:draw-offer", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!gameActive(room)) {
        cb?.({ ok: false, error: "Ván chưa đang chơi hoặc đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      // Toggle cancel if this player already offered
      if (room.drawOfferFrom === color) {
        room.drawOfferFrom = null;
        emitRoom(io, room);
        cb?.({ ok: true, room: publicRoom(room), cancelled: true });
        return;
      }
      // One pending offer at a time — ignore if opponent already offered
      if (room.drawOfferFrom && room.drawOfferFrom !== color) {
        cb?.({ ok: false, error: "Đối thủ đang xin hòa. Hãy chấp nhận hoặc từ chối." });
        return;
      }
      room.drawOfferFrom = color;
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:draw-accept", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!gameActive(room)) {
        cb?.({ ok: false, error: "Ván chưa đang chơi hoặc đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (!room.drawOfferFrom || room.drawOfferFrom === color) {
        cb?.({ ok: false, error: "Không có lời xin hòa từ đối thủ." });
        return;
      }
      endByAgreement(room);
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:draw-decline", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      if (!gameActive(room)) {
        cb?.({ ok: false, error: "Ván chưa đang chơi hoặc đã kết thúc." });
        return;
      }
      const color = markForSocket(room, socket.id);
      if (!color) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      if (!room.drawOfferFrom || room.drawOfferFrom === color) {
        cb?.({ ok: false, error: "Không có lời xin hòa từ đối thủ." });
        return;
      }
      room.drawOfferFrom = null;
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:rematch", (cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      clearTurnTimer(room);
      room.game = new Chess();
      room.winner = null;
      room.endReason = null;
      room.drawOfferFrom = null;
      room.lastMove = null;
      room.lastMoveAuto = false;
      room.hostReady = false;
      room.guestReady = false;
      emitRoom(io, room);
      cb?.({ ok: true, room: publicRoom(room) });
    });

    socket.on("chess:react", (emoji, cb) => {
      const code = socket.data.chessCode;
      const room = code ? chessRooms.get(code) : null;
      if (!room) {
        cb?.({ ok: false, error: "Chưa vào phòng." });
        return;
      }
      const seat = socket.id === room.hostId ? "host" : socket.id === room.guestId ? "guest" : null;
      if (!seat) {
        cb?.({ ok: false, error: "Bạn không trong phòng." });
        return;
      }
      const allowed = ["thumbsup", "laugh", "wow", "fire", "cry", "party", "clap", "heart"];
      if (!allowed.includes(emoji)) {
        cb?.({ ok: false, error: "Emoji không hợp lệ." });
        return;
      }
      const color = seat === "host" ? "white" : "black";
      io.to(code).emit("chess:reaction", { emoji, seat, color, at: Date.now() });
      cb?.({ ok: true });
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

module.exports = { registerChess };
