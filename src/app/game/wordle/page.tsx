"use client";

import Lobby from "@/components/Lobby";

export default function WordleLobbyPage() {
  return (
    <Lobby prefix="wordle" title="Wordle đối kháng — 2 người">
      <div className="space-y-2 text-sm text-slate-400">
        <p>Cả hai cùng đoán <strong className="text-slate-200">một từ tiếng Anh 5 chữ cái</strong>, mỗi người tối đa 6 lượt.</p>
        <p>
          Sau mỗi lượt: <span className="rounded bg-[#6aaa64] px-1.5 font-bold text-white">xanh</span> đúng chữ đúng chỗ,{" "}
          <span className="rounded bg-[#c9b458] px-1.5 font-bold text-white">vàng</span> có chữ nhưng sai chỗ,{" "}
          <span className="rounded bg-[#787c7e] px-1.5 font-bold text-white">xám</span> không có trong từ.
        </p>
        <p>Ai đoán ra với ít lượt hơn thắng; bằng lượt thì ai nhanh hơn thắng. Cả hai trượt thì hòa. Bạn chỉ thấy màu của đối thủ, không thấy chữ.</p>
      </div>
    </Lobby>
  );
}
