"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket() {
  if (typeof window === "undefined") return null;
  if (!socket) {
    socket = io({
      path: "/api/socketio",
      autoConnect: true,
    });
  }
  return socket;
}