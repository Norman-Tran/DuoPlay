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
| **UNO** | Luật chính thức Mattel cho 2 người: bộ 108 lá, chia 7 lá, lật lá mở bài (gặp +4 thì xáo lại). Đánh cùng màu/số/ký hiệu; 2 người thì **Đổi chiều = Mất lượt**; +2 bắt bốc 2 và mất lượt; Đổi màu chọn màu; **+4** chỉ hợp lệ khi không còn lá cùng màu — đối thủ được **thách đấu** (gian lận → người đánh bốc 4, không gian lận → người thách bốc 6). Không đánh được thì bốc 1, lá bốc đánh được thì có thể đánh ngay. Hô **UNO!** khi còn 1 lá, quên mà bị **bắt lỗi** trước lượt kế tiếp thì bốc 2. Hết nọc thì xáo lại chồng bài đã đánh (trừ lá trên cùng). Điểm: số = mặt số, lá chức năng 20, Đổi màu 50; trận tới 200/300/500. Bài giấu phía server. Hiệu ứng lá bay vào chồng bài có nghiêng ngẫu nhiên, lá bốc bay từ nọc và lật, chữ UNO nổ, banner mất lượt/+2/+4, vòng sáng màu hiện tại. |
| **Cờ vây** | Bàn 9×9 / 13×13 / 19×19, Đen đi trước (chủ phòng cầm Đen, chơi lại thì đổi màu). Bắt quân khi hết khí, **cấm tự sát**, **Ko** theo siêu Ko vị trí (không được lặp lại thế cờ cũ — bao gồm Ko đơn). Hai bên bỏ lượt liên tiếp → giai đoạn **đánh dấu quân chết** (bấm vào nhóm, cả hai phải Đồng ý, đổi đánh dấu thì phải đồng ý lại; có nút Đánh tiếp) → máy tự tính điểm theo **luật Trung Quốc (tính diện tích)**: quân trên bàn + đất vây được, **komi 7.5** cho Trắng. Chọn luật diện tích vì tính tự động đơn giản, ít tranh cãi hơn luật Nhật (tính đất + tù binh). Xin thua, đồng hồ tùy chọn: giờ chính + byo-yomi (5′+3×30s, 10′+3×30s, 20′+5×30s), hết byo-yomi thì thua. Bàn gỗ kaya có vân, sao (hoshi), toạ độ; quân đen/trắng có đổ bóng; dấu nước cuối, quân mờ khi rê chuột chỉ hiện ở điểm hợp lệ, đếm quân bắt được, hiệu ứng đặt quân, quân bị bắt mờ dần, lớp hiển thị đất khi tính điểm, bật/tắt số thứ tự nước. |
| Bắn bong bóng | *Sắp ra mắt.* |

## Điều hướng

Thanh điều hướng cố định ở góc trên bên trái, giống nhau trên mọi trang: logo **DuoPlay**, ở lobby có nút **🏠 Trang chủ**, trong phòng có thêm **← Lobby &lt;game&gt;**. Về trang chủ chỉ cần một lần bấm.

## Công nghệ

- **Next.js 15** (App Router) + **React 19** + **TypeScript** + **Tailwind CSS 3**
- **Socket.io 4** trên cùng origin (path `/api/socketio`), server tùy biến `server.js`
- Logic game chạy trên server (authoritative): `chess-server.js` (`chess.js`), `mines-server.js`, `pool-server.js`, `wordle-server.js`, `domino-server.js`, `uno-server.js`, `go-server.js`; `room-kit.js` là phần phòng dùng chung cho Wordle/Domino/UNO/Cờ vây
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

## Bảo mật

DuoPlay là app giải trí không có tài khoản/database, nhưng khi mở ra Internet qua tunnel thì server vẫn được bảo vệ một số lớp (`security.js`, `next.config.ts`):

**Giới hạn tần suất & tài nguyên** (đổi được bằng biến môi trường):

| Giới hạn | Mặc định | Biến môi trường |
|---|---|---|
| Kết nối đồng thời mỗi IP | 20 | `MAX_CONN_PER_IP` |
| Sự kiện socket mỗi kết nối | 40/giây, tối đa dồn 80 | `RATE_EVENTS_PER_SEC`, `RATE_EVENT_BURST` |
| Tạo + vào phòng mỗi kết nối | 20/phút | `RATE_ROOM_OPS_PER_MIN` |
| Tạo phòng mỗi IP | 10/phút | `RATE_CREATE_PER_MIN_IP` |
| Tổng số phòng trên server (mọi game) | 500 | `MAX_ROOMS_TOTAL` |
| Kích thước gói socket | 16 KB (socket.io), dữ liệu đã giải mã ≤ 4 KB | `MAX_PAYLOAD_BYTES` |
| Xoá phòng trống (không ai kết nối) | sau 5 phút | `EMPTY_ROOM_TTL_MS` |
| Xoá phòng không hoạt động | sau 2 giờ | `IDLE_ROOM_TTL_MS` |

Dọn phòng chạy mỗi phút, huỷ luôn các timer của phòng. IP thật lấy từ `cf-connecting-ip` chỉ khi kết nối đến từ loopback (cloudflared), nên client ngoài không giả được.

**Kiểm tra dữ liệu đầu vào:** tên sự kiện phải dạng `game:action`; payload bị từ chối nếu lồng quá 4 cấp, chuỗi > 256 ký tự, mảng > 64 phần tử, > 32 trường, dữ liệu nhị phân, hoặc có khoá `__proto__`/`constructor`. Callback giả (không phải hàm) không làm server lỗi (`ack(cb)`), và mọi handler được bọc try/catch nên payload lạ chỉ nhận `ok:false`. `tests/security.test.js` có fuzz test gửi 1.200 payload ngẫu nhiên tới mọi sự kiện của mọi game.

**HTTP headers & CORS:** Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`…; vẫn cần `'unsafe-inline'` cho script khởi động của Next.js), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS (chỉ có tác dụng qua HTTPS), tắt `X-Powered-By`. Socket.io chỉ nhận kết nối **cùng origin** (chặn cross-site WebSocket hijacking); thêm origin khác bằng `ALLOWED_ORIGINS=https://a.com,https://b.com`.

**Giới hạn:** không có đăng nhập — ai có mã phòng đều vào được nếu phòng còn chỗ; bộ đếm giới hạn nằm trong RAM (khởi động lại là reset); lớp chặn DevTools (GuardShell) chỉ để răn đe.

## Test

```bash
node tests/chess-clock.test.js   # đồng hồ FIDE, cộng giờ, hết giờ thua/hòa
node tests/pool-rules.test.js    # luật 8-ball + vật lý/xoáy
node tests/wordle.test.js        # chấm màu chữ lặp, thắng/hòa
node tests/domino.test.js        # chia bài, người đi trước, nối quân, bốc/qua lượt, chặn bài, giấu bài
node tests/uno.test.js           # bộ 108 lá, chia bài, lá hợp lệ, thách đấu +4, phạt UNO, xáo lại, tính điểm, Đổi chiều 2 người
node tests/security.test.js      # giới hạn tần suất, origin, dọn phòng, fuzz test (~2 phút)
node tests/go.test.js            # bắt quân, cấm tự sát, Ko, 2 lần bỏ lượt, tính diện tích 9×9, đánh dấu quân chết, byo-yomi
```

## Cấu trúc thư mục

```
server.js              # HTTP + Next + Socket.io, đăng ký các *-server.js (Caro nằm trong file này)
chess-server.js  mines-server.js  pool-server.js  wordle-server.js  domino-server.js  uno-server.js  go-server.js
room-kit.js            # create/join/ready/rematch/react/disconnect dùng chung
security.js            # rate limit, giới hạn phòng, dọn phòng, kiểm tra payload, origin check
data/                  # danh sách từ Wordle + giấy phép
src/app/               # trang Next.js: / (chọn game), /game/<game> (lobby), /game/<game>/[code] (phòng)
src/components/        # TopNav, BackLink, GameIcon, GameBackground, GuardShell, ChessPiece, DominoTile, UnoCard, Lobby, RoomKit
src/lib/               # games.ts (danh sách game), socket.ts, dominoLayout.ts
tests/                 # node tests
```

## Ghi công / Credits

- Danh sách từ Wordle: **SCOWL** © Kevin Atkinson (giấy phép kiểu MIT, xem `data/SCOWL-LICENSE.txt`) và **dwyl/english-words** (Unlicense). Chi tiết: `data/README.md`. Wordle là thương hiệu của The New York Times; đây là bản fan-made không liên quan.
- Vật lý bida: tài liệu của **Dr. Dave Alciatore** (billiards.colostate.edu) và mô hình của **pooltool** (Evan Kiefl); kích thước bàn/lỗ theo **WPA**.
- Luật cờ vua & đồng hồ: **FIDE Laws of Chess** (Handbook E.I.01A, Điều 6). Luật domino: pagat.com (*Draw Dominoes*). Luật UNO: hướng dẫn chính thức của Mattel (UNO instructions, service.mattel.com). Luật cờ vây: Sensei's Library (senseis.xmp.net — Chinese/area scoring, superko) và luật của Hiệp hội cờ vây Trung Quốc.
- Quân cờ và quân domino vẽ bằng SVG trong code, không dùng asset bên ngoài.
