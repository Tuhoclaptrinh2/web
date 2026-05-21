# Tiên Dịch Pro - Công cụ dịch Web Novel Trung - Việt

Đây là ứng dụng dịch truyện Trung - Việt sử dụng sức mạnh của Google Gemini AI.

## Hướng dẫn cài đặt và chạy trên máy cá nhân

1. **Cài đặt Node.js**: Đảm bảo máy bạn đã cài Node.js (phiên bản 18 trở lên).
2. **Tải mã nguồn**: Tải về hoặc `git clone` dự án này.
3. **Cài đặt thư viện**:
   ```bash
   npm install
   ```
4. **Cấu hình API Key**:
   - Copy file `.env.example` thành `.env`.
   - Truy cập [Google AI Studio](https://aistudio.google.com/app/apikey) để lấy API Key miễn phí.
   - Dán API Key vào file `.env` ở dòng `GEMINI_API_KEY=...`.
5. **Chạy ứng dụng**:
   ```bash
   npm run dev
   ```
   - Sau khi chạy, truy cập đường dẫn hiện ra (thường là `http://localhost:3000`).

## Hướng dẫn Deploy lên GitHub Pages / Vercel / Netlify

Nếu bạn đã up lên GitHub và muốn deploy để người khác dùng:

### Cách 1: Sử dụng Vercel (Khuyên dùng - Cực nhanh)
1. Truy cập [Vercel](https://vercel.com/) và kết nối với tài khoản GitHub của bạn.
2. Chọn project này để "Import".
3. **QUAN TRỌNG**: Trong phần **Environment Variables**, hãy thêm:
   - Key: `VITE_GEMINI_API_KEY`
   - Value: (Dán API Key của bạn vào đây - ví dụ: AIzaSy...)
4. Nhấn "Deploy".

### Cách 2: Sử dụng GitHub Pages
- Bạn cần sửa `vite.config.ts` để thêm `base: '/ten-kho-cua-ban/'`.
- Tuy nhiên, việc để API Key trực tiếp trên GitHub Pages không an toàn. Hãy cân nhắc dùng Vercel và thiết lập Environment Variables như Cách 1.

## Tại sao link deploy nhấn vào không có gì/trắng xóa?

1. **Chưa Build**: Bạn cần chạy `npm run build` để tạo ra thư mục `dist`. Nếu deploy thủ công, bạn phải upload nội dung trong thư mục `dist` chứ không phải toàn bộ code.
2. **Thiếu API Key**: Kiểm tra xem bạn đã thêm `GEMINI_API_KEY` trong phần cài đặt (Settings/Environment Variables) của trang hosting chưa.
3. **Lỗi đường dẫn**: Kiểm tra Console (F12) xem có báo lỗi `404 Not Found` cho các file script không.
