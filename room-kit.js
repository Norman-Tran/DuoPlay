const { ack } = require("./security");
/**
 * Shared 2-player room plumbing (create/join/state/ready/rematch/react/disconnect)
 * used by wordle-server.js and domino-server.js. Updates are emitted per socket
 * so each player can receive a private view (hidden hands / hidden letters).
 *
 * game hooks:
 *   newGame(room, opts)        -> initialise room.game (called on create + rematch)
 *   onStart(room, io)          -> both seated & ready
 *   view(room, seat)           -> game-specific public state for `seat`
 *   isOver(room)               -> boolean
 *   actions: { [event]: (room, seat, payload, ctx) => {ok, error?} }
 */
const REACTIONS = ["thumbsup", "laugh", "wow", "fire", "cry", "party", "clap", "heart"];

function makeCode(map) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return map.has(code) ? makeCode(map) : code;
}

function createRoomKit(prefix, game) {
  /** @type {Map<string, any>} */
  const rooms = new Map();
  const seatOf = (room, sid) => (sid === room.hostId ? "host" : sid === room.guestId ? "guest" : null);
  const started = (room) => Boolean(room.hostId && room.guestId && room.hostReady && room.guestReady);

  function publicRoom(room, seat) {
    return {
      code: room.code,
      hostSeated: Boolean(room.hostId),
      guestSeated: Boolean(room.guestId),
      hostReady: room.hostReady,
      guestReady: room.guestReady,
      started: room.started,
      score: { ...room.score },
      ...game.view(room, seat),
    };
  }

  function emit(io, room) {
    for (const seat of ["host", "guest"]) {
      const sid = seat === "host" ? room.hostId : room.guestId;
      if (sid) io.to(sid).emit(`${prefix}:update`, publicRoom(room, seat));
    }
  }

  function register(io) {
    io.on("connection", (socket) => {
      const ctx = { io, emit: (room) => emit(io, room) };
      const myRoom = () => {
        const code = socket.data[`${prefix}Code`];
        return code ? rooms.get(code) : null;
      };
      const reply = (cb, room, extra = {}) =>
        ack(cb)({ ok: true, seat: seatOf(room, socket.id), room: publicRoom(room, seatOf(room, socket.id)), ...extra });

      socket.on(`${prefix}:create`, (opts, cb) => {
        if (typeof opts === "function") [cb, opts] = [opts, {}];
        const room = {
          code: makeCode(rooms), hostId: socket.id, guestId: null,
          hostReady: false, guestReady: false, started: false,
          score: { host: 0, guest: 0 }, opts: opts || {},
        };
        game.newGame(room, room.opts);
        rooms.set(room.code, room);
        socket.join(room.code);
        socket.data[`${prefix}Code`] = room.code;
        reply(cb, room);
      });

      socket.on(`${prefix}:join`, (code, cb) => {
        const room = rooms.get(String(code || "").trim().toUpperCase());
        if (!room) return ack(cb)({ ok: false, error: "Không tìm thấy phòng." });
        if (seatOf(room, socket.id)) return reply(cb, room);
        if (!room.hostId) room.hostId = socket.id;
        else if (!room.guestId) room.guestId = socket.id;
        else return ack(cb)({ ok: false, error: "Phòng đã đủ 2 người." });
        socket.join(room.code);
        socket.data[`${prefix}Code`] = room.code;
        reply(cb, room);
        emit(io, room);
      });

      socket.on(`${prefix}:state`, (cb) => {
        const room = myRoom();
        if (!room || !seatOf(room, socket.id)) return ack(cb)({ ok: false, error: "Chưa vào phòng." });
        reply(cb, room);
      });

      socket.on(`${prefix}:ready`, (ready, cb) => {
        const room = myRoom();
        const seat = room && seatOf(room, socket.id);
        if (!seat) return ack(cb)({ ok: false, error: "Chưa vào phòng." });
        if (room.started) return ack(cb)({ ok: false, error: "Ván đang diễn ra." });
        if (game.isOver(room)) return ack(cb)({ ok: false, error: "Ván đã kết thúc. Hãy chơi lại." });
        room[`${seat}Ready`] = Boolean(ready);
        if (started(room)) {
          room.started = true;
          game.onStart(room, ctx);
        }
        emit(io, room);
        reply(cb, room);
      });

      for (const [event, fn] of Object.entries(game.actions)) {
        socket.on(`${prefix}:${event}`, (payload, cb) => {
          if (typeof payload === "function") [cb, payload] = [payload, undefined];
          const room = myRoom();
          const seat = room && seatOf(room, socket.id);
          if (!seat) return ack(cb)({ ok: false, error: "Chưa vào phòng." });
          if (!room.started || game.isOver(room)) return ack(cb)({ ok: false, error: "Ván chưa bắt đầu hoặc đã kết thúc." });
          const res = fn(room, seat, payload, ctx) || { ok: true };
          if (!res.ok) return ack(cb)(res);
          emit(io, room);
          reply(cb, room, res);
        });
      }

      socket.on(`${prefix}:rematch`, (opts, cb) => {
        if (typeof opts === "function") [cb, opts] = [opts, undefined];
        const room = myRoom();
        if (!room || !seatOf(room, socket.id)) return ack(cb)({ ok: false, error: "Chưa vào phòng." });
        if (room.started && !game.isOver(room)) return ack(cb)({ ok: false, error: "Ván đang diễn ra." });
        if (opts && seatOf(room, socket.id) === "host") room.opts = { ...room.opts, ...opts };
        game.newGame(room, room.opts, true);
        room.started = false;
        room.hostReady = false;
        room.guestReady = false;
        emit(io, room);
        reply(cb, room);
      });

      socket.on(`${prefix}:react`, (emoji, cb) => {
        const room = myRoom();
        const seat = room && seatOf(room, socket.id);
        if (!seat) return ack(cb)({ ok: false, error: "Chưa vào phòng." });
        if (!REACTIONS.includes(emoji)) return ack(cb)({ ok: false, error: "Emoji không hợp lệ." });
        io.to(room.code).emit(`${prefix}:reaction`, { emoji, seat, at: Date.now() });
        ack(cb)({ ok: true });
      });

      socket.on("disconnect", () => {
        const room = myRoom();
        if (!room) return;
        const seat = seatOf(room, socket.id);
        if (!seat) return;
        room[`${seat}Id`] = null;
        room[`${seat}Ready`] = false;
        room.score = { host: 0, guest: 0 };
        if (!room.hostId && !room.guestId) {
          game.dispose?.(room);
          rooms.delete(room.code);
          return;
        }
        emit(io, room);
        io.to(room.code).emit(`${prefix}:peer-left`, { seat });
      });
    });
  }

  return { register, rooms, publicRoom };
}

module.exports = { createRoomKit };
