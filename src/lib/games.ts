export type GameStatus = "playable" | "coming_soon";

export type GameMeta = {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  status: GameStatus;
  href?: string;
  /** accent glow color (rgb with alpha) */
  glow: string;
};

export const GAMES: GameMeta[] = [
  {
    id: "caro",
    glow: "rgb(244 114 182 / 0.55)",
    name: "Cờ Caro",
    emoji: "⭕",
    blurb: "Bàn 15/30/45, chặn 2 đầu, Ready, timer 45s, điểm phiên.",
    status: "playable",
    href: "/game/caro",
  },
  {
    id: "chess",
    glow: "rgb(250 204 21 / 0.5)",
    name: "Cờ vua",
    emoji: "♟️",
    blurb: "2 người realtime, luật chuẩn (chess.js), đồng hồ FIDE (Bullet→Classical), biên bản nước đi, điểm phiên.",
    status: "playable",
    href: "/game/chess",
  },
  {
    id: "mines",
    glow: "rgb(248 113 113 / 0.55)",
    name: "Dò mìn",
    emoji: "💣",
    blurb: "Đua tốc độ 2 người, cùng bản đồ mìn. Phá hết ô an toàn trước là thắng; dính bom thua ngay.",
    status: "playable",
    href: "/game/mines",
  },
  {
    id: "pool",
    glow: "rgb(52 211 153 / 0.55)",
    name: "Bida lỗ",
    emoji: "🎱",
    blurb: "8-ball 2 người, góc + lực, line hướng ngắn, đồng hồ 60s mỗi cú bắn.",
    status: "playable",
    href: "/game/pool",
  },
  {
    id: "bubbles",
    glow: "rgb(56 189 248 / 0.45)",
    name: "Bắn bong bóng",
    emoji: "🫧",
    blurb: "Arcade puzzle vui, sắp mở.",
    status: "coming_soon",
  },
];
