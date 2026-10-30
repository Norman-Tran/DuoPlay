# DuoPlay

Trang web game **chỉ dành cho 2 người** (bạn và bạn bè): tạo phòng bằng mã, chơi realtime.

Hiện có **Cờ Caro** chơi được. Cờ vua, bắn bong bóng, bida lỗ = *Coming soon*.

## Chạy local

```bash
cd D:\Code\DuoPlay
npm install
npm run dev
```

Mở: **http://localhost:3100**

> Dev dùng `server.js` (Next.js + Socket.io cùng process). Không dùng `next dev` thuần nếu muốn realtime phòng.

Build production:

```bash
npm run build
set NODE_ENV=production
npm start
```

## Cách chơi Caro nhanh

1. Máy A: vào **Cờ Caro** → **Tạo phòng** → copy mã 6 ký tự.
2. Máy B (hoặc tab khác): **Vào** bằng mã đó.
3. Host = X, Guest = O. Xen kẽ đánh; **5 quân liên tiếp** (ngang/dọc/chéo) trên bàn **15×15** là thắng.
4. **Chơi lại** sau khi hết ván.

## Kiến trúc (stub → hoàn chỉnh)

| Phần | Hiện tại | Hướng tiếp |
|---|---|---|
| Lobby / danh sách game | Có | Thêm thumbnail, filter |
| Phòng realtime | Socket.io in-memory | Persist Redis, TTL phòng |
| Caro | Đủ 2 người + win | Undo, xếp hạng, anti-cheat nhẹ |
| Cờ vua / bubbles / bida | Coming soon | Từng game một module |
| Auth | Không | Tuỳ chọn guest nickname |
| Deploy | Local only | Vercel + Socket server riêng hoặc Railway |

## Roadmap gợi ý

1. Nickname trong phòng + reconnect cùng mã.
2. Game 2: Cờ vua (lib sẵn hoặc board tối giản).
3. Âm thanh / hiệu ứng thắng.
4. Deploy: tách `socket` server nếu host serverless.
5. Thêm Bida / Bubbles khi core phòng ổn định.

## Ghi chú

- Repo **local-only**, chưa gắn GitHub remote.
- State phòng lưu **RAM** — restart server mất phòng đang mở.