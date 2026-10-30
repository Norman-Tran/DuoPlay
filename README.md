# DuoPlay 🎮 — Arcade cho 2 người

Web game giải trí realtime chỉ dành cho **2 người**: tạo phòng, gửi mã 6 ký tự cho bạn, cùng vào chơi. Không cần tài khoản, không có database — mọi phòng/ván nằm trong bộ nhớ server Node (khởi động lại server là mất phòng).

*A small 2‑player realtime arcade (Next.js + Socket.io). UI in Vietnamese.*

## Các game

Tất cả game đều có: phòng theo mã, **Ready** trước khi chơi, **chơi lại (rematch)**, **điểm phiên** (reset khi có người rời phòng), **reaction** emoji nhanh.

| Game | Luật & tính năng |
|---|---|
| **Cờ Caro** | Bàn 15/30/45. 5 quân liên tiếp thắng, **chặn 2 đầu** thì không tính. Mỗi nước 45s, hết giờ server đánh ngẫu nhiên. |
| **Cờ vua** | Luật chuẩn qua `chess.js` (nhập thành, bắt tốt qua đường, phong cấp, chiếu hết, pat, lặp 3 lần, 50 nước, thiếu quân). **Đồng hồ theo FIDE**: tổng giờ + giây cộng (Bullet 1+0/2+1, Blitz 3+0/3+2/5+0/5+3, Rapid 10+0/10+5/15+10, Classical 30+0, Không giới hạn). Hết giờ thua, trừ khi đối thủ không còn đủ quân chiếu hết → hòa (Điều 6.9). Đồng hồ mỗi bên chạy sau nước đầu tiên của bên đó (giống lichess). Biên bản nước đi SAN, quân bị ăn + chênh lệch chất, xin hòa, xin thua. |
| **Dò mìn** | Đua tốc độ 2 người trên **cùng bản đồ mìn** (Dễ/Vừa/Khó). Mở hết ô an toàn trước là thắng, dính mìn thua ngay. |
| **Bida lỗ (8-ball)** | Vật lý do server tính (bàn theo kích thước WPA, miệng lỗ có vát). Kéo cơ lùi để lấy lực (có giới hạn), **đánh xoáy** (xoáy lên/xuống/ngang, bi trượt → lăn, xoáy ăn băng), đường ngắm + bi bóng mờ, đặt bi tự do bằng kéo thả, thanh bi còn lại hai bên. |
| **Wordle đối kháng** | Hai người cùng đoán **một từ tiếng Anh 5 chữ**, 6 lượt mỗi người. Màu chuẩn NYT: xanh `#6aaa64` đúng chỗ, vàng `#c9b458` có nhưng sai chỗ, xám `#787c7e` không có (xử lý chữ lặp như bản gốc). Hiệu ứng gõ chữ, lật ô so le, rung hàng khi từ không có trong từ điển, nảy sóng khi đoán đúng. Bàn phím ảo + bàn phím thật. Chỉ thấy **màu** bàn của đối thủ. Ít lượt hơn thắng; bằng lượt thì nhanh hơn thắng; cả hai trượt → hòa và lộ từ. |
| **Domino** | Double-six, kiểu **bốc (Draw)**: mỗi người 7 quân, 14 quân trong nọc. Ván đầu ai có đôi lớn nhất (hoặc quân lớn nhất) đi trước bằng quân đó; ván sau người thắng ván trước đi trước. Không nối được thì bốc tới khi được, hết nọc thì qua lượt. Hết bài: cộng chấm trên tay đối thủ; chặn bài: bên ít chấm hơn được phần chênh lệch. Trận tới 50/100/150. Bài trên tay được giấu (server chỉ gửi bài của bạn + số quân đối thủ). Bàn nối kiểu rắn, quân đôi đặt ngang, tự rẽ 90° khi chạm mép. |
| Bắn bong bóng | *Sắp ra mắt.* |

## Công nghệ

- **Next.js 15** (App Router) + **React 19** + **TypeScript** + **Tailwind CSS 3**
- **Socket.io 4** trên cùng origin (path `/api/socketio`), server tùy biến `server.js`
- Logic game chạy trên server (authoritative): `chess-server.js` (`chess.js`), `mines-server.js`, `pool-server.js`, `wordle-server.js`, `domino-server.js`; `room-kit.js` là phần phòng dùng chung cho Wordle/Domino
- Không có database

## Chạy local

```bash
npm install
npm run dev          # http://localhost:3100
PORT=3200 npm run dev   # đổi cổng (Windows PowerShell: $env:PORT=3200; npm run dev)
```

Biến môi trường:
- `PORT` — cổng server, mặc định **3100**.
- `NEXT_PUBLIC_GUARD` — `1`/`0` bật/tắt lớp chặn chuột phải, F12, Ctrl+U/S, Ctrl+Shift+I/J/C, bôi đen chữ. Mặc định **bật ở production, tắt ở dev**. ⚠️ Đây chỉ là **biện pháp răn đe**, không phải bảo mật — ai biết kỹ thuật vẫn mở DevTools được. Biến `NEXT_PUBLIC_*` được nhúng lúc build, nên đổi xong phải build lại.

## Build production

```bash
npm run build
NODE_ENV=production npm start      # PowerShell: $env:NODE_ENV="production"; npm start
```

## Host cho bạn bè (Cloudflare quick tunnel)

```bash
cloudflared tunnel --url http://localhost:3100
```

Lệnh in ra một link `https://<random>.trycloudflare.com` để gửi cho bạn. Link đổi mỗi lần chạy lại tunnel; muốn link cố định cần domain riêng + named tunnel.

## Test

```bash
node tests/chess-clock.test.js   # đồng hồ FIDE, cộng giờ, hết giờ thua/hòa
node tests/pool-rules.test.js    # luật 8-ball + vật lý/xoáy
node tests/wordle.test.js        # chấm màu chữ lặp, thắng/hòa
node tests/domino.test.js        # chia bài, người đi trước, nối quân, bốc/qua lượt, chặn bài, giấu bài
```

## Cấu trúc thư mục

```
server.js              # HTTP + Next + Socket.io, đăng ký các *-server.js (Caro nằm trong file này)
chess-server.js  mines-server.js  pool-server.js  wordle-server.js  domino-server.js
room-kit.js            # create/join/ready/rematch/react/disconnect dùng chung
data/                  # danh sách từ Wordle + giấy phép
src/app/               # trang Next.js: / (chọn game), /game/<game> (lobby), /game/<game>/[code] (phòng)
src/components/        # BackLink, GameIcon, GameBackground, GuardShell, ChessPiece, DominoTile, Lobby, RoomKit
src/lib/               # games.ts (danh sách game), socket.ts, dominoLayout.ts
tests/                 # node tests
```

## Ghi công / Credits

- Danh sách từ Wordle: **SCOWL** © Kevin Atkinson (giấy phép kiểu MIT, xem `data/SCOWL-LICENSE.txt`) và **dwyl/english-words** (Unlicense). Chi tiết: `data/README.md`. Wordle là thương hiệu của The New York Times; đây là bản fan-made không liên quan.
- Vật lý bida: tài liệu của **Dr. Dave Alciatore** (billiards.colostate.edu) và mô hình của **pooltool** (Evan Kiefl); kích thước bàn/lỗ theo **WPA**.
- Luật cờ vua & đồng hồ: **FIDE Laws of Chess** (Handbook E.I.01A, Điều 6). Luật domino: pagat.com (*Draw Dominoes*).
- Quân cờ và quân domino vẽ bằng SVG trong code, không dùng asset bên ngoài.
