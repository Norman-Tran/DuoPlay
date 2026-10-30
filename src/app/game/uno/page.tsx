"use client";

import { useState } from "react";
import Lobby from "@/components/Lobby";

export default function UnoLobbyPage() {
  const [target, setTarget] = useState(500);
  return (
    <Lobby prefix="uno" title="UNO — 2 người" createOpts={{ target }}>
      <div className="space-y-2 text-sm text-slate-400">
        <p>Bộ 108 lá, mỗi người 7 lá. Đánh lá cùng <b className="text-slate-200">màu</b>, cùng <b className="text-slate-200">số</b> hoặc cùng <b className="text-slate-200">ký hiệu</b>; lá Đổi màu đánh lúc nào cũng được.</p>
        <p>Chơi 2 người: Đổi chiều = Mất lượt, đánh xong được đi tiếp. +2 bắt đối thủ bốc 2 và mất lượt. +4 chỉ hợp lệ khi bạn không còn lá cùng màu — đối thủ có thể <b className="text-slate-200">thách đấu</b>.</p>
        <p>Không đánh được thì bốc 1 lá; đánh được thì đánh luôn. Còn 1 lá phải hô <b className="text-amber-300">UNO!</b>, quên mà bị bắt lỗi thì bốc 2. Hết bài: cộng điểm bài trên tay đối thủ (số = mặt số, lá chức năng 20, lá Đổi màu 50).</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-300">Chơi tới</p>
        <div className="flex gap-2">
          {[200, 300, 500].map((t) => (
            <button key={t} type="button" onClick={() => setTarget(t)}
              className={`btn-fx rounded-lg border px-4 py-1.5 font-mono text-sm ${target === t ? "border-cyan-400 bg-cyan-500 text-slate-950" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500"}`}>
              {t} điểm
            </button>
          ))}
        </div>
      </div>
    </Lobby>
  );
}
