export type GameStatus = "playable" | "coming_soon";

export type GameMeta = {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  status: GameStatus;
  href?: string;
};

export const GAMES: GameMeta[] = [
  {
    id: "caro",
    name: "Cờ Caro",
    emoji: "⭕",
    blurb: "Bàn 15/30/45, chặn 2 đầu, Ready, timer 45s, điểm phiên.",
    status: "playable",
    href: "/game/caro",
  },
  {
    id: "chess",
    name: "Cờ vua",
    emoji: "♟️",
    blurb: "2 người realtime, luật chuẩn (chess.js), timer 60s, Ready, điểm phiên.",
    status: "playable",
    href: "/game/chess",
  },
  {
    id: "mines",
    name: "Dò mìn",
    emoji: "💣",
    blurb: "Đua tốc độ 2 người, cùng bản đồ mìn. Phá hết ô an toàn trước là thắng; dính bom thua ngay.",
    status: "playable",
    href: "/game/mines",
  },
  {
    id: "pool",
    name: "Bida lỗ",
    emoji: "🎱",
    blurb: "8-ball 2 người, góc + lực, line hướng ngắn, đồng hồ 60s mỗi cú bắn.",
    status: "playable",
    href: "/game/pool",
  },
  {
    id: "bubbles",
    name: "Bắn bong bóng",
    emoji: "🫧",
    blurb: "Arcade puzzle vui, sắp mở.",
    status: "coming_soon",
  },
];
