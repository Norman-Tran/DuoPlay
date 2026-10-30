"use client";

import { useState } from "react";
import Lobby from "@/components/Lobby";

const CLOCKS = [
  ["none", "Không giới hạn"],
  ["5m+30x3", "5 phút + 3×30s"],
  ["10m+30x3", "10 phút + 3×30s"],
  ["20m+30x5", "20 phút + 5×30s"],
];

export default function GoLobbyPage() {
  const [size, setSize] = useState(19);
  const [clock, setClock] = useState("none");
  const pick = (on: boolean) =>
    `btn-fx rounded-lg border px-3 py-1.5 font-mono text-sm ${on ? "border-cyan-400 bg-cyan-500 text-slate-950" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500"}`;
  return (
    <Lobby prefix="go" title="Cờ vây — 2 người" createOpts={{ size, clock }}>
      <div className="space-y-2 text-sm text-slate-400">
        <p>Chủ phòng cầm <b className="text-slate-200">Đen</b> và đi trước (ván sau đổi màu). Một nhóm quân hết khí thì bị bắt. Không được tự sát, không được lặp lại thế cờ cũ (luật Ko).</p>
        <p>Hai bên cùng bỏ lượt liên tiếp thì vào giai đoạn <b className="text-slate-200">đánh dấu quân chết</b>; cả hai đồng ý thì máy tự tính điểm theo <b className="text-slate-200">luật Trung Quốc (tính diện tích)</b>: quân trên bàn + đất vây được. Trắng được komi 7.5.</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-300">Kích thước bàn</p>
        <div className="flex gap-2">
          {[9, 13, 19].map((s) => (
            <button key={s} type="button" onClick={() => setSize(s)} className={pick(size === s)}>{s}×{s}</button>
          ))}
        </div>
        <p className="pt-2 text-sm font-medium text-slate-300">Đồng hồ (giờ chính + byo-yomi)</p>
        <div className="flex flex-wrap gap-2">
          {CLOCKS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setClock(k)} className={pick(clock === k)}>{l}</button>
          ))}
        </div>
      </div>
    </Lobby>
  );
}
