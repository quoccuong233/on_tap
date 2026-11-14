# Thả đề vào đây → web tự cập nhật

Tải file đề (**PDF, Word .docx, hoặc .txt**) vào thư mục này. Khoảng 1–2 phút sau web tự có chương mới.
Kết quả mỗi lần (thêm được bao nhiêu câu, câu nào bị bỏ, vì sao) nằm ở file **`KET_QUA.md`** ngay trong thư mục này.

## Đặt file thế nào

**Cách 1 — máy tính (kéo cả thư mục):** tạo thư mục mang tên môn, bỏ file vào, rồi kéo cả thư mục vào trang này
(**Add file → Upload files**):

```
nhap/
└── Kinh tế vi mô/
    ├── Chương 1 - Tổng quan.pdf
    └── Chương 2 - Cung cầu.docx
```

**Cách 2 — điện thoại (không tạo được thư mục):** đặt tên file theo dạng `Tên môn - Chương N - Tên chương`:

```
Kinh tế vi mô - Chương 3 - Độ co giãn.pdf
```

- **Tên môn** trùng môn đã có (ví dụ `Pháp luật đại cương` hoặc `pldc`) → thêm chương vào môn đó. Tên mới → tự tạo môn mới.
- Muốn chọn biểu tượng cho môn mới: thêm emoji cuối tên thư mục, ví dụ `Kinh tế vi mô 📈`.
- **Số chương** lấy từ tên file (`Chương 2`, `chuong2`, `C2`, `2 - …`). Không có số → lấy số trống tiếp theo.
- Tải lại file có **cùng số chương** → chương cũ được **thay** bằng bản mới (dùng để sửa đề).

## Đề cần viết thế nào

```
Câu 1: Nội dung câu hỏi (được phép xuống dòng)
A. Đáp án A
B. Đáp án B
C. Đáp án C
D. Đáp án D
Đáp án: B
Giải thích: (không bắt buộc) hiện ra sau khi trả lời
```

Đáp án đúng được nhận theo **một trong các cách** sau:

| Cách | Ví dụ |
|---|---|
| Dòng đáp án sau mỗi câu | `Đáp án: B` · `ĐA: B` · `Đáp án đúng là B` |
| Bảng đáp án cuối file | dòng `ĐÁP ÁN` rồi `1.A 2.C 3-B …`, hoặc bảng *Câu \| Đáp án* trong Word |
| Dấu * | `*B. …` hoặc `B. … (*)` |
| Định dạng (Word) | đáp án đúng **in đậm**, gạch chân, tô màu chữ hoặc tô nền |
| Định dạng (PDF) | đáp án đúng **in đậm** hoặc tô màu chữ |

Cũng đọc được: `Câu 1.` / `1.` / `Question 1`, đáp án `A.` / `A)` / `(A)`, cả 4 đáp án viết chung 1 dòng, từ 2 đến 8 đáp án.

## Không đọc được

- **.doc** (Word đời cũ) → mở bằng Word, *Lưu thành* `.docx`.
- **PDF scan / ảnh chụp / "Print to PDF"** → vẫn đọc được (nhận chữ từ ảnh – OCR), nhưng lâu hơn và có thể sai vài dấu, nên lướt lại.
- Câu nào không tìm ra đáp án đúng sẽ bị bỏ và liệt kê trong `KET_QUA.md`. Sửa file rồi tải lại là xong.
- File không lấy được câu nào sẽ bị gỡ khỏi `nhap/` và tab Actions báo ❌ (lý do ghi trong `KET_QUA.md`). Sửa rồi tải lại là được.
