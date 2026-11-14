# Ôn tập trắc nghiệm

Web ôn tập trắc nghiệm chạy hoàn toàn trên trình duyệt, không cần server.

## Tính năng
- Chọn một hoặc nhiều chương để ôn
- **Luyện tập**: chọn đáp án là biết đúng/sai ngay
- **Thi thử**: làm hết rồi nộp bài, có điểm thang 10
- Trộn thứ tự câu hỏi và đáp án
- Tự lưu **câu làm sai** để ôn lại (lưu trên trình duyệt của bạn)
- **Xem đáp án** toàn bộ đề, có ô tìm kiếm (gõ không dấu cũng được)
- Có nút **✕ Thoát** khi đang làm bài (hoặc bấm `Esc`)
- Có giao diện tối, dùng tốt trên điện thoại

## Chạy trên máy
Bấm đúp vào `index.html`, hoặc chạy:
```bash
npx serve .
```

## Đưa lên GitHub Pages
1. Tạo repo mới trên GitHub ở chế độ **Public**
2. Bấm **Add file → Upload files**, kéo **toàn bộ** file và thư mục `data/` vào, rồi bấm **Commit**
3. Vào **Settings → Pages**, ở mục Source chọn **GitHub Actions** (workflow `cap-nhat-web.yml` sẽ tự đưa web lên mỗi lần có thay đổi)
4. Đợi 1–2 phút, web sẽ có ở `https://<tên-bạn>.github.io/<tên-repo>/`

## Cấu trúc
```
data/
├── mon.js            ← danh sách các môn
├── pldc/             ← Pháp luật đại cương (mỗi môn 1 thư mục)
│   ├── chuong1.js    ← Nhà nước (73 câu)
│   ├── chuong2.js    ← Pháp luật (45 câu)
│   ├── chuong3.js    ← Quy phạm pháp luật, văn bản QPPL (60 câu)
│   ├── chuong4.js    ← Quan hệ pháp luật (46 câu)
│   ├── chuong5.js    ← Vi phạm pháp luật, trách nhiệm pháp lý (45 câu)
│   └── chuong6.js    ← Hệ thống pháp luật, các ngành luật (244 câu)
├── attt/             ← An toàn thông tin
│   ├── chuong1.js    ← 116 câu (mã hóa, mật mã)
│   └── chuong2.js    ← 227 câu (mã độc, tấn công, mạng)
├── tthcm/            ← Tư tưởng Hồ Chí Minh
│   ├── chuong1.js    ← Chương 1 + 2 (57 câu)
│   ├── chuong3.js    ← Chương 3 + 4 (81 câu)
│   ├── chuong5.js    ← Chương 5 (45 câu)
│   └── chuong6.js    ← Chương 6 (37 câu)
└── cnxhkh/           ← Chủ nghĩa xã hội khoa học
    └── chuong1.js … chuong7.js   ← 7 chương (203 câu)
```

## Thêm đề tự động (khuyên dùng)
Tải file đề **PDF / Word .docx / .txt** vào thư mục [`nhap/`](nhap/HUONG_DAN.md), đặt trong thư mục mang tên môn
(ví dụ `nhap/Kinh tế vi mô/Chương 2 - Cung cầu.pdf`). GitHub Actions sẽ tự chuyển đề thành `data/<môn>/chuongN.js`,
tự thêm môn mới vào `data/mon.js` rồi đưa web lên lại. Cách viết đề và cách đánh dấu đáp án: xem [`nhap/HUONG_DAN.md`](nhap/HUONG_DAN.md).

Cần bật 1 lần: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Phần chuyển đề nằm ở `.github/scripts/chuyen_doi.py`, quy trình ở `.github/workflows/cap-nhat-web.yml`.

## Thêm chương mới (thủ công)
Đặt file `chuongN.js` (N từ 1 đến 40) vào thư mục của môn, ví dụ `data/pldc/chuong4.js`. Web tự nhận ra, **không cần sửa code**.

## Thêm môn mới (thủ công)
1. Mở `data/mon.js` và thêm 1 dòng: `addSubject({ id: "kinh-te", name: "Kinh tế vi mô", icon: "📈" });`
2. Tạo thư mục `data/kinh-te/` rồi đặt các file `chuong1.js`, `chuong2.js`… vào đó.

Mẫu một file chương:
```js
addChapter({
  order: 4,
  title: "Chương 4: ...",
  questions: [
    { q: "Câu hỏi?", options: ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"], answer: 0 },
    // answer: 0 = A, 1 = B, 2 = C, 3 = D
    // có thể thêm  note: "ghi chú"  để hiện giải thích sau khi trả lời
  ]
});
```
