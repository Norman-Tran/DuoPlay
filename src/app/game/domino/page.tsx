"use client";

import { useState } from "react";
import Lobby from "@/components/Lobby";

export default function DominoLobbyPage() {
  const [target, setTarget] = useState(100);
  return (
    <Lobby prefix="domino" title="Domino — double-six 2 người" createOpts={{ target }}>
      <div className="space-y-2 text-sm text-slate-400">
        <p>Bộ 28 quân (0-0 đến 6-6). Mỗi người bốc 7 quân, 14 quân còn lại để trong nọc.</p>
        <p>Ván đầu, ai có quân đôi lớn nhất đi trước (không có đôi thì quân lớn nhất). Nối quân vào một trong hai đầu có cùng số chấm; quân đôi đặt ngang.</p>
        <p>Không đánh được thì bốc nọc tới khi đánh được; hết nọc thì qua lượt. Hết bài: cộng tổng chấm trên tay đối thủ. Chặn bài: ai ít chấm hơn thắng phần chênh lệch.</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-300">Chơi tới</p>
        <div className="flex gap-2">
          {[50, 100, 150].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTarget(t)}
              className={`btn-fx rounded-lg border px-4 py-1.5 font-mono text-sm ${
                target === t ? "border-cyan-400 bg-cyan-500 text-slate-950" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500"
              }`}
            >
              {t} điểm
            </button>
          ))}
        </div>
      </div>
    </Lobby>
  );
}
