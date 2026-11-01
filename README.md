# Ôn tập trắc nghiệm

Web ôn tập trắc nghiệm chạy hoàn toàn trên trình duyệt, không cần server.

## Tính năng
- Chọn một hoặc nhiều chương để ôn
- **Luyện tập**: chọn đáp án là biết đúng/sai ngay
- **Thi thử**: làm hết rồi nộp bài, có điểm thang 10
- Trộn thứ tự câu hỏi và đáp án
- Tự lưu **câu làm sai** để ôn lại (lưu trên trình duyệt của bạn)
- **Xem đáp án** toàn bộ đề, có ô tìm kiếm (gõ không dấu cũng được)
- Có giao diện tối, dùng tốt trên điện thoại

## Chạy trên máy
Bấm đúp vào `index.html`, hoặc chạy:
```bash
npx serve .
```

## Đưa lên GitHub Pages
1. Tạo repo mới trên GitHub ở chế độ **Public**
2. Bấm **Add file → Upload files**, kéo **toàn bộ** file và thư mục `data/` vào, rồi bấm **Commit**
3. Vào **Settings → Pages**, ở mục Source chọn **Deploy from a branch**, branch `main`, thư mục `/ (root)`, rồi bấm **Save**
4. Đợi 1–2 phút, web sẽ có ở `https://<tên-bạn>.github.io/<tên-repo>/`

## Cấu trúc
```
data/
├── mon.js            ← danh sách các môn
├── pldc/             ← mỗi môn 1 thư mục
│   └── chuong3.js
└── attt/             ← An toàn thông tin
    ├── chuong1.js    ← 116 câu (mã hóa, mật mã)
    └── chuong2.js    ← 227 câu (mã độc, tấn công, mạng)
```

## Thêm chương mới
Đặt file `chuongN.js` (N từ 1 đến 40) vào thư mục của môn, ví dụ `data/pldc/chuong4.js`. Web tự nhận ra, **không cần sửa code**.

## Thêm môn mới
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
