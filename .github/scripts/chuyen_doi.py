#!/usr/bin/env python3
"""
Chuyển file đề trắc nghiệm (PDF / Word .docx / .txt) trong thư mục nhap/
thành file data/<mã-môn>/chuongN.js cho web ôn tập, và tự thêm môn mới vào data/mon.js.

Cách đặt file (xem nhap/HUONG_DAN.md):
    nhap/<Tên môn>/<Tên chương>.pdf|.docx|.txt
    hoặc   nhap/<Tên môn> - Chương N - <tên>.pdf   (khi không tạo được thư mục, ví dụ trên điện thoại)

Đáp án đúng được nhận theo thứ tự ưu tiên:
    1. Dòng "Đáp án: B" (hoặc "ĐA: B", "Answer: B") ngay sau câu hỏi
    2. Bảng đáp án cuối file ("1.A 2.C 3-B…", hoặc bảng Câu | Đáp án trong Word)
    3. Dấu * trước/sau đáp án ("*B. …", "B. … *")
    4. Đáp án duy nhất được in đậm / gạch chân / tô màu / tô nền (Word), in đậm / tô màu (PDF)

Chạy thử trên máy:
    python .github/scripts/chuyen_doi.py            # xử lý nhap/
    python .github/scripts/chuyen_doi.py --thu FILE  # chỉ in kết quả đọc 1 file, không ghi gì
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NHAP = ROOT / "nhap"
DATA = ROOT / "data"
MON_JS = DATA / "mon.js"
MAX_CHAPTER = 40
LETTERS = "ABCDEFGH"
BO_QUA = {"huong_dan", "ket_qua", "readme", ".gitkeep"}
IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
DUOI_HO_TRO = {".pdf", ".docx", ".txt"} | IMG_EXTS


# ------------------------------------------------------------------ dòng chữ
@dataclass
class Line:
    """Một dòng chữ + đánh dấu từng ký tự (in đậm / gạch chân / tô màu)."""
    text: str
    marks: list = field(default_factory=list)
    hint: str | None = None  # "q" / "opt" nếu Word tự đánh số câu / chữ cái
    color: float = 0.0       # độ "nổi màu" của dòng khi đọc từ ảnh (OCR)
    ocr: bool = False        # dòng đọc từ ảnh → chữ cái đáp án có thể bị nhầm (B↔8, C↔c…)

    def __post_init__(self):
        if len(self.marks) != len(self.text):
            self.marks = [False] * len(self.text)

    def sub(self, a: int, b: int | None = None) -> "Line":
        return Line(self.text[a:b], self.marks[a:b], color=self.color, ocr=self.ocr)

    def strip(self) -> "Line":
        t = self.text
        a = len(t) - len(t.lstrip())
        b = len(t.rstrip())
        return Line(t[a:b], self.marks[a:b], self.hint, self.color, self.ocr)

    def frac_marked(self) -> float:
        idx = [i for i, c in enumerate(self.text) if not c.isspace()]
        if not idx:
            return 0.0
        return sum(1 for i in idx if self.marks[i]) / len(idx)


def make_line(runs, hint=None) -> list[Line]:
    """runs = [(chuỗi, có_đánh_dấu)] → các Line (tách theo xuống dòng)."""
    text, marks = "", []
    for s, m in runs:
        s = unicodedata.normalize("NFC", s.replace(" ", " ").replace("​", ""))
        s = s.replace("\t", " ").replace("\r", "\n").replace("\x0b", "\n")
        text += s
        marks += [bool(m)] * len(s)
    out, start = [], 0
    for i, c in enumerate(text + "\n"):
        if c == "\n":
            out.append(Line(text[start:i], marks[start:i]))
            start = i + 1
    out = [l for l in out if l.text.strip()]
    if out and hint:
        out[0].hint = hint
    return out


# ------------------------------------------------------------------ đọc file
def read_txt(path: Path):
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-16", "cp1258", "latin-1"):
        try:
            s = raw.decode(enc)
            if enc == "utf-16" and not raw.startswith((b"\xff\xfe", b"\xfe\xff")):
                continue
            break
        except UnicodeDecodeError:
            continue
    lines = []
    for ln in s.splitlines():
        lines += make_line([(ln, False)])
    return lines, {}


def _docx_numbering(document):
    """numId → {ilvl: numFmt} để biết đoạn nào Word tự đánh số 1,2,3 hay A,B,C."""
    from docx.oxml.ns import qn
    fmt = {}
    try:
        numbering = document.part.numbering_part.element
    except Exception:
        return fmt
    abstract = {}
    for an in numbering.findall(qn("w:abstractNum")):
        lv = {}
        for l in an.findall(qn("w:lvl")):
            nf = l.find(qn("w:numFmt"))
            lv[l.get(qn("w:ilvl"))] = nf.get(qn("w:val")) if nf is not None else None
        abstract[an.get(qn("w:abstractNumId"))] = lv
    for n in numbering.findall(qn("w:num")):
        a = n.find(qn("w:abstractNumId"))
        if a is not None:
            fmt[n.get(qn("w:numId"))] = abstract.get(a.get(qn("w:val")), {})
    return fmt


def _run_marked(run) -> bool:
    from docx.enum.dml import MSO_COLOR_TYPE
    from docx.oxml.ns import qn
    f = run.font
    from docx.enum.text import WD_COLOR_INDEX, WD_UNDERLINE
    if f.bold or f.underline not in (None, False, WD_UNDERLINE.NONE) or f.highlight_color not in (None, WD_COLOR_INDEX.AUTO):
        return True
    try:
        if f.color is not None and f.color.type == MSO_COLOR_TYPE.RGB and f.color.rgb is not None:
            r, g, b = f.color.rgb[0], f.color.rgb[1], f.color.rgb[2]
            if max(r, g, b) - min(r, g, b) > 60:  # có màu rõ (không phải đen/xám)
                return True
    except Exception:
        pass
    rpr = run._r.rPr
    if rpr is not None:
        shd = rpr.find(qn("w:shd"))
        if shd is not None and (shd.get(qn("w:fill")) or "auto").lower() not in ("auto", "ffffff", "000000"):
            return True
    return False


def _para_lines(p, numfmt):
    from docx.oxml.ns import qn
    from docx.text.run import Run
    runs = []
    for r in p._p.iter(qn("w:r")):
        run = Run(r, p)
        runs.append((run.text, _run_marked(run)))
    hint = None
    numpr = p._p.pPr.numPr if p._p.pPr is not None else None
    if numpr is None:
        try:
            spr = p.style.element.pPr
            numpr = spr.numPr if spr is not None else None
        except Exception:
            numpr = None
    if numpr is not None and numpr.numId is not None:
        nid = str(numpr.numId.val)
        lvl = str(numpr.ilvl.val) if numpr.ilvl is not None else "0"
        f = numfmt.get(nid, {}).get(lvl)
        if f in ("upperLetter", "lowerLetter"):
            hint = "opt"
        elif f in ("decimal", "decimalZero"):
            hint = "q"
    return make_line(runs, hint)


def _table_key(grid):
    """Nhận bảng đáp án: hàng/cột số câu kề hàng/cột chữ cái."""
    key = {}
    is_num = lambda s: re.fullmatch(r"(?:câu|cau)?\s*\d{1,3}", s.strip(), re.I) is not None
    is_let = lambda s: re.fullmatch(r"\(?[A-Ha-h]\)?\.?", s.strip()) is not None

    def scan(rows):
        found = {}
        for a, b in zip(rows, rows[1:]):
            pairs = [(x, y) for x, y in zip(a, b) if x.strip() or y.strip()]
            good = [(x, y) for x, y in pairs if is_num(x) and is_let(y)]
            if len(good) >= 2 and len(good) >= len(pairs) - 1:
                for x, y in good:
                    found[int(re.sub(r"\D", "", x))] = re.sub(r"[^A-Ha-h]", "", y).upper()
        return found

    key.update(scan(grid))
    width = max((len(r) for r in grid), default=0)
    cols = [[r[i] if i < len(r) else "" for r in grid] for i in range(width)]
    key.update(scan(cols))
    return key


def read_docx(path: Path):
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    document = docx.Document(str(path))
    numfmt = _docx_numbering(document)
    lines, key = [], {}
    for el in document.element.body.iterchildren():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "p":
            lines += _para_lines(Paragraph(el, document), numfmt)
        elif tag == "tbl":
            t = Table(el, document)
            grid = []
            for row in t.rows:
                seen, cells = set(), []
                for c in row.cells:
                    if id(c._tc) in seen:  # ô gộp
                        continue
                    seen.add(id(c._tc))
                    cells.append(c)
                grid.append([c.text for c in cells])
            tk = _table_key(grid)
            if tk:
                key.update(tk)
                continue
            for row in t.rows:
                seen = set()
                for c in row.cells:
                    if id(c._tc) in seen:
                        continue
                    seen.add(id(c._tc))
                    for p in c.paragraphs:
                        lines += _para_lines(p, numfmt)
    return lines, key


def _pdf_char_marked(ch) -> bool:
    fn = (ch.get("fontname") or "").lower()
    if any(k in fn for k in ("bold", "black", "heavy", "semibold", ",b")):
        return True
    col = ch.get("non_stroking_color")
    if isinstance(col, (list, tuple)) and all(isinstance(v, (int, float)) for v in col):
        if len(col) == 3 and max(col) - min(col) > 0.25:
            return True
        if len(col) == 4 and max(col[:3]) - min(col[:3]) > 0.25:
            return True
    return False


OCR_USED = set()  # file nào phải đọc chữ từ ảnh


TESSDATA = Path(os.environ.get("OCR_TESSDATA", Path.home() / ".cache" / "ontap-tessdata"))
VIE_URL = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/vie.traineddata"


def ensure_tesseract():
    """Cần Tesseract + dữ liệu tiếng Việt (bản 'fast': nhanh, đủ chính xác cho đề in).
    Trên GitHub Actions tự cài khi lần đầu cần OCR."""
    import shutil
    import subprocess
    import urllib.request
    if not shutil.which("tesseract") and os.environ.get("GITHUB_ACTIONS") == "true":
        print("Cài Tesseract OCR…", flush=True)
        subprocess.run("sudo rm -f /var/lib/man-db/auto-update; sudo apt-get update -qq && "
                       "sudo apt-get install -y -qq --no-install-recommends tesseract-ocr",
                       shell=True, check=False, stdout=subprocess.DEVNULL, timeout=600)
    if not shutil.which("tesseract"):
        return False
    vie = TESSDATA / "vie.traineddata"
    if not vie.exists():
        TESSDATA.mkdir(parents=True, exist_ok=True)
        try:
            print("Tải dữ liệu chữ tiếng Việt cho OCR…", flush=True)
            urllib.request.urlretrieve(VIE_URL, vie)
            if vie.stat().st_size < 100_000:
                vie.unlink()
        except Exception as e:
            print("Không tải được dữ liệu tiếng Việt:", e, flush=True)
    return vie.exists()


def _remove_lines(gray):
    """Xóa đường kẻ dài (khung viền ô đáp án, gạch ngang) — Tesseract hay bỏ sót chữ nằm trong ô có viền."""
    try:
        import numpy as np
    except ImportError:
        return gray
    from PIL import Image, ImageFilter
    # cân bằng nền: chia cho độ sáng nền cục bộ → nền tô màu/xám thành trắng, chữ vẫn đen
    bg = np.asarray(gray.filter(ImageFilter.MaxFilter(21)), dtype=np.float32)
    a = np.clip(np.asarray(gray, dtype=np.float32) * 255.0 / np.maximum(bg, 1.0), 0, 255).astype(np.uint8)
    dark = a < 170
    H, W = dark.shape

    def long_runs(mask, L, axis):
        n = mask.shape[axis]
        if n <= L:
            return np.zeros_like(mask)
        pad = [(0, 0), (0, 0)]
        pad[axis] = (1, 0)
        cs = np.pad(np.cumsum(mask, axis=axis, dtype=np.int32), pad)
        win = (np.take(cs, range(L, n + 1), axis=axis) - np.take(cs, range(0, n - L + 1), axis=axis)) >= L
        sc = np.pad(np.cumsum(win, axis=axis, dtype=np.int32), pad)
        idx = np.arange(n)
        hi, lo = np.minimum(idx + 1, n - L + 1), np.clip(idx - L + 1, 0, n - L + 1)
        return (np.take(sc, hi, axis=axis) - np.take(sc, lo, axis=axis)) > 0

    k = W / 1600
    thick = max(8, int(12 * k))
    hl = long_runs(dark, max(40, int(90 * k)), 1)
    hl &= ~long_runs(hl, thick, 0)   # chỉ đường mảnh; mảng tô màu dày giữ nguyên
    vl = long_runs(dark, max(30, int(55 * k)), 0)
    vl &= ~long_runs(vl, thick, 1)
    a[hl | vl] = 255
    return Image.fromarray(a)


def _line_color(img_hsv, box) -> float:
    """Độ 'nổi màu' của 1 dòng chữ = độ bão hòa màu trung bình quanh dòng (0–255).
    Chữ đen/xám trên nền trắng/xám ≈ 0; chữ đỏ/xanh hoặc dòng tô nền (kể cả màu nhạt) cao hơn rõ."""
    from PIL import ImageChops, ImageStat
    x0, y0, x1, y1 = box
    pad = 8
    crop = img_hsv.crop((max(0, x0 - pad), max(0, y0 - pad), x1 + pad, y1 + pad))
    _, sat, val = crop.split()
    bright = val.point(lambda v: 0 if v < 50 else 255)  # bỏ điểm gần đen: màu ở đó không đáng tin
    return ImageStat.Stat(ImageChops.multiply(sat, bright)).mean[0]


def ocr_images(images: dict, label: str):
    """Đọc chữ (tiếng Việt) từ các ảnh {khóa: ảnh PIL}. Trả về {khóa: [Line]}.
    Mỗi dòng có điểm 'nổi màu' (tô nền / chữ màu) → dùng để nhận đáp án đúng."""
    import subprocess
    import tempfile
    from concurrent.futures import ThreadPoolExecutor
    if not images or not ensure_tesseract():
        return {}
    tmp = Path(tempfile.mkdtemp())
    files = {}
    from PIL import ImageChops
    for k, im in images.items():
        f = tmp / f"p{k}.png"
        r, g, b = im.convert("RGB").split()
        # ảnh cho OCR = kênh tối nhất: chữ màu (đỏ, xanh) thành đen, nền màu nhạt gần như trắng; bỏ khung viền
        _remove_lines(ImageChops.darker(ImageChops.darker(r, g), b)).save(f)
        files[k] = f
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}  # mỗi tiến trình 1 luồng, chạy song song theo trang

    def one(k):
        try:
            r = subprocess.run(["tesseract", str(files[k]), "-", "--tessdata-dir", str(TESSDATA), "-l", "vie", "--psm", "4",
                                "-c", "tessedit_create_tsv=1"],
                               capture_output=True, text=True, env=env, timeout=180)
        except subprocess.TimeoutExpired:
            return k, []
        rows, order = {}, []
        for ln in r.stdout.splitlines()[1:]:
            c = ln.split("\t")
            if len(c) < 12 or c[0] != "5" or not c[11].strip():
                continue
            key = (c[2], c[3], c[4])  # khối, đoạn, dòng
            x, y, w, h = map(int, c[6:10])
            if key not in rows:
                rows[key] = {"words": [], "box": [x, y, x + w, y + h]}
                order.append(key)
            b = rows[key]["box"]
            rows[key]["words"].append(c[11])
            rows[key]["box"] = [min(b[0], x), min(b[1], y), max(b[2], x + w), max(b[3], y + h)]
        hsv = images[k].convert("RGB").convert("HSV")
        out = []
        for key in order:
            t = ocr_fix(" ".join(rows[key]["words"]))
            if t:
                out.append(Line(t, color=_line_color(hsv, rows[key]["box"]), ocr=True))
        return k, out

    print(f"Đọc chữ từ ảnh {len(images)} trang của {label}…", flush=True)
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 2) as ex:
        return dict(ex.map(one, list(images)))


def ocr_pages(path: Path, page_numbers):
    """Đọc chữ từ ảnh các trang PDF không có lớp chữ (scan, Print to PDF)."""
    import pypdfium2 as pdfium
    if not page_numbers:
        return {}
    doc = pdfium.PdfDocument(str(path))
    images = {i: doc[i].render(scale=300 / 72).to_pil() for i in page_numbers}
    doc.close()
    return ocr_images(images, path.name)


def read_image(path: Path):
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(path))
    if max(im.size) < 1600:  # ảnh chụp màn hình nhỏ → phóng to cho OCR đọc tốt hơn
        f = 1600 / max(im.size)
        im = im.resize((int(im.width * f), int(im.height * f)), Image.LANCZOS)
    res = ocr_images({0: im}, path.name)
    if res:
        OCR_USED.add(str(path))
    return res.get(0, []), {}


def ocr_fix(t: str) -> str:
    """Sửa lỗi OCR hay gặp ở đầu dòng đáp án: '€.' → 'C.', 'A,.' → 'A.', 'D.FTP' → 'D. FTP'."""
    t = t.strip()
    # ký tự rác do nút tròn / ô chọn đứng trước đáp án: "©A.FTP", "O@C.443", "@cC.443", "○ B. …"
    t = re.sub(r"^(?:[^\w\sÀ-ỹ(]|[Oo0QcCe](?=\s*[^\w\s]|\s*[A-H]\s*[.,:;)]))(?:\s*(?:[^\w\sÀ-ỹ(]|[Oo0QcCe](?=\s*[A-H]\s*[.,:;)])))*\s*(?=[A-H€]\s*[.,:;)])", "", t)
    t = re.sub(r"^[€©¢Ç](?=\s*[.,:;)])", "C", t)
    t = re.sub(r"^\(?([A-H])\s*[,;:]+\.?\s*", r"\1. ", t)
    t = re.sub(r"^\(?([A-H])\s*\.(?=\S)", r"\1. ", t)
    t = re.sub(r"^(Câu\s*\d+)\s*[,;:]\s*", r"\1. ", t)
    return t


def read_pdf(path: Path):
    import pdfplumber
    lines = []
    with pdfplumber.open(str(path)) as pdf:
        empty = [i for i, pg in enumerate(pdf.pages) if not any(c["text"].strip() for c in pg.chars)]
        ocr = ocr_pages(path, empty) if empty else {}
        if ocr:
            OCR_USED.add(str(path))
        for pi, page in enumerate(pdf.pages):
            if pi in ocr:
                lines += ocr[pi]
                continue
            for tl in page.extract_text_lines(return_chars=True, strip=True):
                chars = [c for c in tl["chars"] if c["text"].strip()]
                runs, ci = [], 0
                for c in tl["text"]:
                    if c.isspace():
                        runs.append((c, False))
                        continue
                    m = False
                    # khớp ký tự của dòng với ký tự trong PDF để lấy kiểu chữ
                    while ci < len(chars) and chars[ci]["text"] != c and len(chars[ci]["text"]) == 1:
                        ci += 1
                    if ci < len(chars):
                        m = _pdf_char_marked(chars[ci])
                        ci += 1
                    runs.append((c, m))
                for l in make_line(runs):
                    # bỏ số trang / dòng "Trang x"
                    if re.fullmatch(r"(?:trang\s*)?\d{1,3}(?:\s*/\s*\d{1,3})?", l.text.strip(), re.I):
                        continue
                    lines.append(l)
    return lines, {}


def read_any(path: Path):
    ext = path.suffix.lower()
    if ext == ".pdf":
        return read_pdf(path)
    if ext == ".docx":
        return read_docx(path)
    if ext in IMG_EXTS:
        return read_image(path)
    return read_txt(path)


# ------------------------------------------------------------------ phân tích
MARK = r"[*✓✔√]"
Q_RE = re.compile(r"^(?:câu|cau|question|q)\s*(?:hỏi\s*|hoi\s*)?(?:số\s*|so\s*)?(\d{1,3})\s*[.:)\-–—]?\s*", re.I)
NUM_RE = re.compile(r"^(\d{1,3})\s*[.)]\s+")
ANS_LONG = r"(?:đáp\s*án(?:\s*đúng)?|dap\s*an(?:\s*dung)?|answer|=>|->|→)"
ANS_SHORT = r"(?:đ\.?\s*a|d\.?\s*a|ans|key)"
ANS_WORDS = rf"(?:{ANS_LONG}|{ANS_SHORT})"
ANS_RE = re.compile(rf"^(?:{ANS_LONG}\s*(?:là|la|is)?\s*[:：=]?|{ANS_SHORT}\s*[:：=])\s*\(?([A-Ha-h])\)?(?![\wÀ-ỹ])\s*[.:,;\-–—]?\s*(.*)$", re.I)
ANS_INLINE_RE = re.compile(rf"[\s(\[]{ANS_WORDS}\s*(?:là|la|is)?\s*[:：=]\s*\(?([A-Ha-h])\)?(?![\wÀ-ỹ])[\])]?\s*[.:,;\-–—]?\s*(.*)$", re.I)
KEY_HEAD_RE = re.compile(r"^(?:bảng\s*|bang\s*)?(?:đáp\s*án|dap\s*an|answer\s*key|answers?|key|ĐA)\s*[:：.]?\s*$", re.I)
KEY_PAIR_RE = re.compile(r"(?<!\d)(\d{1,3})\s*[.:)\-–—]?\s*\(?([A-Ha-h])\)?(?![\wÀ-ỹ])")
NOTE_RE = re.compile(r"^(?:giải\s*thích|giai\s*thich|gợi\s*ý|goi\s*y|lời\s*giải|loi\s*giai|ghi\s*chú|ghi\s*chu|note|explanation)\s*[:：]\s*", re.I)
TRAIL_MARK_RE = re.compile(r"\s*(?:\(\s*\*\s*\)|\(\s*(?:đúng|dung|đ|x)\s*\)|\[\s*x\s*\]|" + MARK + r")\s*$", re.I)
MON_RE = re.compile(r"^môn(?:\s*học)?\s*[:：]\s*(.+)$|^mon(?:\s*hoc)?\s*[:：]\s*(.+)$", re.I)
OCR_OPT_RE = re.compile(r"^(?:[^A-Za-z0-9\s]|[OoQ0Il|]){0,4}\s*(?P<L>[^\s.,:;)])\s*[.,:;)]\s*(?=\S)")
OCR_CONFUSE = {"A": "Aa4Á", "B": "Bb8ßsSR3E", "C": "Cc€GgeéçÇ(©", "D": "Dd0OoPđĐ", "E": "EeÉ", "F": "FfP", "G": "Gg6", "H": "Hh"}
SECTION_RE = re.compile(r"^(?:phần|phan|part|mục|muc|chương|chuong|chapter)\s+[\dIVXivx]+\b.*$", re.I)
CHUONG_RE = re.compile(r"^(?:chương|chuong|chapter|bài|bai)\s*(\d{1,2})\s*[:.\-–—]?\s*(.*)$", re.I)


def opt_re(letter: str, lower: bool, inline: bool):
    L = f"[{letter}{letter.lower()}]" if lower else letter
    after = r"\s+" if inline else r"\s*"
    return re.compile(rf"(?P<pre>{MARK}\s*)?\(?(?P<L>{L})(?P<mid>\s*\*)?\s*[.):](?P<post>{after}{MARK})?{after}")


def key_line_pairs(text: str):
    pairs = KEY_PAIR_RE.findall(text)
    if len(pairs) < 2:
        return None
    rest = KEY_PAIR_RE.sub(" ", text)
    rest = re.sub(r"(?i)câu|cau|đáp\s*án|dap\s*an|ĐA", " ", rest)
    if re.fullmatch(r"[\s,;|/.:\-–—]*", rest):
        return {int(n): l.upper() for n, l in pairs}
    return None


@dataclass
class Opt:
    line: Line
    explicit: bool = False


@dataclass
class Q:
    num: int | None
    stem: list = field(default_factory=list)
    opts: list = field(default_factory=list)
    answer: str | None = None
    note: str = ""
    nospace: bool = False


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


class Parser:
    def __init__(self, lines, key):
        self.lines = lines
        self.key = dict(key)
        self.qs: list[Q] = []
        self.cur: Q | None = None
        self.mode = "head"  # head | stem | opt | note | key
        self.key_fresh = False
        self.pending: list[Line] = []
        self.head_mon = None
        self.head_chuong = None
        texts = [l.text.strip() for l in lines]
        self.cau_style = sum(1 for t in texts if Q_RE.match(t)) >= 2
        up = sum(1 for t in texts if re.match(r"^\(?[A-H]\s*[.)]", t))
        low = sum(1 for t in texts if re.match(r"^\(?[a-h]\s*[.)]", t))
        self.lower = low > up

    # --- tiện ích
    def expected(self):
        return LETTERS[len(self.cur.opts)] if self.cur and len(self.cur.opts) < len(LETTERS) else None

    def finish(self):
        if self.cur is not None:
            self.flush_pending()
            self.qs.append(self.cur)
        self.cur = None

    def flush_pending(self):
        if not self.pending or self.cur is None:
            self.pending = []
            return
        if self.mode == "note":
            self.cur.note = clean(self.cur.note + " " + " ".join(l.text for l in self.pending))
        elif self.cur.opts:
            o = self.cur.opts[-1]
            for l in self.pending:
                o.line = Line(o.line.text + " " + l.text, o.line.marks + [False] + l.marks, color=max(o.line.color, l.color))
        else:
            self.cur.stem += [l.text for l in self.pending]
        self.pending = []

    def new_q(self, num, stem_line: Line | None):
        self.finish()
        self.cur = Q(num=num)
        self.mode = "stem"
        if stem_line is not None and stem_line.text.strip():
            self.add_text_with_inline(stem_line, in_stem=True)

    def add_option(self, line: Line, explicit: bool):
        explicit = explicit or bool(TRAIL_MARK_RE.search(line.text))
        m = TRAIL_MARK_RE.search(line.text)
        if m:
            line = line.sub(0, m.start())
        self.cur.opts.append(Opt(line.strip(), explicit))
        self.mode = "opt"

    def set_answer(self, letter, note_text=""):
        if self.cur is None:
            return
        self.flush_pending()
        self.cur.answer = letter.upper()
        if note_text and clean(note_text):
            nt = NOTE_RE.sub("", clean(note_text))
            self.cur.note = clean(self.cur.note + " " + nt)
            self.mode = "note"
        else:
            self.mode = "opt"

    def match_option_start(self, line: Line):
        """Dòng bắt đầu bằng đáp án (A. / B) / *C. …)? Trả về (độ dài tiền tố, có dấu *)."""
        if self.cur is None:
            return None
        exp = self.expected()
        cands = []
        if exp:
            cands.append(exp)
        if len(self.cur.opts) >= 2 and "A" not in cands:
            cands.append("A")  # câu mới không đánh số
        for L in cands:
            m = opt_re(L, self.lower, inline=False).match(line.text)
            if not m:
                continue
            rest = line.text[m.end():]
            spaced = m.end() > 0 and line.text[m.end() - 1].isspace()
            punct_paren = ")" in m.group(0)
            nospace_ok = (
                spaced or punct_paren or not rest or rest[0].islower() or rest[0].isdigit()
                or (L == "A" and not self.cur.opts and self.mode == "stem")
                or (L != "A" and self.cur.nospace and L == exp)
            )
            if not nospace_ok:
                continue
            if L == "A":
                self.cur.nospace = not spaced and not punct_paren
            explicit = bool(m.group("pre") or m.group("mid") or m.group("post"))
            return L, m.end(), explicit
        return None

    def match_ocr_option(self, line: Line):
        """Dòng đọc từ ảnh: '8. HTTP' / 's. HTTP' khi đang chờ đáp án B → coi là B."""
        exp = self.expected()
        if not (line.ocr and exp and self.cur is not None and self.mode != "stem" or (line.ocr and exp == "A" and self.cur is not None)):
            return None
        m = OCR_OPT_RE.match(line.text)
        if m and m.group("L") in OCR_CONFUSE.get(exp, exp):
            return exp, m.end(), False
        return None

    def split_inline(self, line: Line, start_letter: str):
        """Tìm các đáp án nằm cùng 1 dòng: '… A. x  B. y  C. z'. Trả về [(vị trí, độ dài tiền tố, explicit)]."""
        found, pos = [], 0
        idx = LETTERS.index(start_letter)
        while idx < len(LETTERS):
            rx = opt_re(LETTERS[idx], self.lower, inline=True)
            m = None
            for mm in rx.finditer(line.text, pos):
                s = mm.start()
                if s == 0 or line.text[s - 1].isspace():
                    m = mm
                    break
            if not m:
                break
            found.append((m.start(), m.end(), bool(m.group("pre") or m.group("mid") or m.group("post"))))
            pos = m.end()
            idx += 1
        return found

    def add_text_with_inline(self, line: Line, in_stem: bool):
        start = self.expected() if self.cur else None
        if start and in_stem and not self.cur.opts:
            parts = self.split_inline(line, "A")
            if len(parts) >= 2:
                before = line.sub(0, parts[0][0]).text.strip()
                if before:
                    self.cur.stem.append(before)
                self.add_parts(line, parts)
                return
        if in_stem:
            self.cur.stem.append(line.text)
        else:
            self.pending.append(line)

    def add_parts(self, line: Line, parts):
        for i, (s, e, ex) in enumerate(parts):
            end = parts[i + 1][0] if i + 1 < len(parts) else None
            self.add_option(line.sub(e, end), ex)

    # --- vòng lặp chính
    def run(self):
        for raw in self.lines:
            line = raw.strip()
            t = line.text
            if not t:
                continue

            # đáp án nằm cuối dòng: "D. … Đáp án: B"
            m_inl = ANS_INLINE_RE.search(t) if self.mode != "key" else None
            tail = None
            if m_inl and not ANS_RE.match(t):
                tail = (m_inl.group(1), m_inl.group(2))
                line = line.sub(0, m_inl.start()).strip()
                t = line.text

            self.handle(line, raw.hint)
            if tail:
                self.set_answer(*tail)
        self.finish()
        return self.qs

    def handle(self, line: Line, hint):
        t = line.text
        if not t:
            return

        # --- bảng đáp án
        if KEY_HEAD_RE.match(t):
            self.flush_pending()
            self.mode = "key"
            self.key_fresh = self.cur is not None and self.cur.answer is None and len(self.cur.opts) >= 2
            return
        kp = key_line_pairs(t)
        if kp and (self.mode == "key" or len(kp) >= 3):
            self.flush_pending()
            self.key.update(kp)
            self.mode = "key"
            return
        if self.mode == "key":
            fresh, self.key_fresh = self.key_fresh, False
            m = re.match(r"\(?([A-Ha-h])\)?(?:\s*[.):\-–—]\s*|\s+|$)(.*)$", t)
            if m and fresh and not kp:
                # "Đáp án:" xuống dòng rồi mới ghi "B" (có thể kèm giải thích)
                self.mode = "opt"
                self.set_answer(m.group(1), m.group(2))
                return
            if kp:
                self.key.update(kp)
                return
            mq = Q_RE.match(t)
            if mq and re.fullmatch(r"\(?[A-Ha-h]\)?\.?", t[mq.end():].strip()):
                self.key[int(mq.group(1))] = re.sub(r"[^A-Ha-h]", "", t[mq.end():]).upper()
                return
            if not (Q_RE.match(t) or (self.cur is None and NUM_RE.match(t))):
                return  # dòng linh tinh trong phần đáp án
            self.mode = "stem"

        # --- dòng đáp án của câu hiện tại
        ma = ANS_RE.match(t)
        if ma and self.cur is not None:
            self.set_answer(ma.group(1), ma.group(2))
            return

        # --- giải thích
        mn = NOTE_RE.match(t)
        if mn and self.cur is not None:
            self.flush_pending()
            self.mode = "note"
            self.cur.note = clean(self.cur.note + " " + t[mn.end():])
            return

        # --- câu hỏi mới
        mq = Q_RE.match(t)
        if mq:
            rest = t[mq.end():].strip()
            if re.fullmatch(r"\(?[A-Ha-h]\)?\.?", rest):  # "Câu 1: A" = dòng bảng đáp án
                self.key[int(mq.group(1))] = re.sub(r"[^A-Ha-h]", "", rest).upper()
                return
            self.new_q(int(mq.group(1)), line.sub(mq.end()))
            return
        mnum = NUM_RE.match(t)
        if mnum and not self.cau_style and (self.cur is None or len(self.cur.opts) >= 2):
            self.new_q(int(mnum.group(1)), line.sub(mnum.end()))
            return
        if hint == "q" and (self.cur is None or len(self.cur.opts) >= 2 or self.mode == "head"):
            self.new_q(None, line)
            return

        # --- tiêu đề phần giữa đề ("Phần 2: …") → bỏ qua
        if self.cur is not None and len(self.cur.opts) >= 2 and SECTION_RE.match(t):
            self.flush_pending()
            self.mode = "opt"
            return

        # --- trước câu hỏi đầu tiên: đọc "Môn: …", "Chương 2: …"
        if self.cur is None:
            mm = MON_RE.match(t)
            if mm:
                self.head_mon = clean(mm.group(1) or mm.group(2))
            mc = CHUONG_RE.match(t)
            if mc and self.head_chuong is None:
                self.head_chuong = (int(mc.group(1)), clean(mc.group(2)))
            return

        # --- đáp án (A. B. C. D.)
        if hint == "opt" and not self.match_option_start(line):
            exp = self.expected()
            if exp:
                if exp != "A" or not self.cur.opts:
                    self.flush_pending()
                    self.add_option(line, False)
                    return
        mo = self.match_option_start(line) or self.match_ocr_option(line)
        if mo:
            L, end, explicit = mo
            if L == "A" and len(self.cur.opts) >= 2:
                # câu mới không đánh số: các dòng chờ là đề của câu mới
                stem = self.pending
                self.pending = []
                self.finish()
                self.cur = Q(num=None, stem=[l.text for l in stem])
                self.mode = "stem"
            else:
                self.flush_pending()
            nxt = LETTERS[LETTERS.index(L) + 1] if L != LETTERS[-1] else None
            more = self.split_inline(line.sub(end), nxt) if nxt else []
            if more and more[0][0] > 0:
                self.add_option(line.sub(end, end + more[0][0]), explicit)
                self.add_parts(line.sub(end), more)
            else:
                self.add_option(line.sub(end), explicit)
            return

        # --- dòng viết tiếp
        if self.mode == "stem":
            self.add_text_with_inline(line, in_stem=True)
        elif self.mode == "note":
            self.cur.note = clean(self.cur.note + " " + t)
        else:
            self.pending.append(line)


def resolve(qs, key):
    """Chọn đáp án đúng cho từng câu. Trả về (câu hợp lệ, danh sách câu bị bỏ + lý do)."""
    good, bad = [], []
    from collections import Counter
    counts = Counter(len(q.opts) for q in qs if len(q.opts) >= 2)
    usual = counts.most_common(1)[0][0] if counts else 0  # số lựa chọn thường gặp trong file
    for i, q in enumerate(qs, 1):
        num = q.num if q.num is not None else i
        stem = clean(" ".join(q.stem))
        opts = [clean(o.line.text) for o in q.opts]
        label = f"Câu {num}"
        preview = (stem[:70] + "…") if len(stem) > 70 else stem
        if not stem:
            bad.append((label, "không có nội dung câu hỏi", preview))
            continue
        if len(opts) < 2:
            bad.append((label, f"chỉ đọc được {len(opts)} đáp án", preview))
            continue
        if any(not o for o in opts):
            bad.append((label, "có đáp án bị trống", preview))
            continue
        ans = None
        if q.answer:
            ans = LETTERS.index(q.answer)
        elif num in key:
            ans = LETTERS.index(key[num])
        else:
            ex = [k for k, o in enumerate(q.opts) if o.explicit]
            if len(ex) == 1:
                ans = ex[0]
            else:
                fm = [k for k, o in enumerate(q.opts) if o.line.frac_marked() >= 0.5]
                if len(fm) == 1:
                    ans = fm[0]
                else:
                    # ảnh: đáp án nổi màu hơn hẳn các đáp án còn lại
                    # (chỉ khi đọc đủ số lựa chọn như các câu khác: thiếu dòng → màu có thể bị dính sang đáp án khác)
                    cs = sorted(((o.line.color, k) for k, o in enumerate(q.opts)), reverse=True)
                    if len(q.opts) >= usual and cs[0][0] >= 6 and cs[0][0] >= 2.5 * cs[1][0] + 2:
                        ans = cs[0][1]
        if ans is None:
            bad.append((label, "không tìm thấy đáp án đúng", preview))
            continue
        if ans >= len(opts):
            bad.append((label, f"đáp án {LETTERS[ans]} nhưng câu chỉ có {len(opts)} lựa chọn", preview))
            continue
        item = {"q": stem, "options": opts, "answer": ans}
        if q.note:
            item["note"] = q.note
        good.append(item)
    return good, bad


def parse_file(path):
    """path: 1 file, hoặc danh sách ảnh của cùng 1 chương (đọc nối tiếp nhau)."""
    lines, key = [], {}
    for one in (path if isinstance(path, list) else [path]):
        l, k = read_any(one)
        lines += l
        key.update(k)
    p = Parser(lines, key)
    qs = p.run()
    good, bad = resolve(qs, p.key)
    return good, bad, p, len(lines)


# ------------------------------------------------------------------ môn & chương
def no_accent(s: str) -> str:
    s = s.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", no_accent(s).lower()).strip()


def read_subjects():
    subs = []
    if MON_JS.exists():
        for m in re.finditer(r'addSubject\(\{\s*id:\s*"([^"]+)",\s*name:\s*"((?:[^"\\]|\\.)*)"(?:,\s*icon:\s*"([^"]*)")?', MON_JS.read_text("utf-8")):
            subs.append({"id": m.group(1), "name": json.loads(f'"{m.group(2)}"'), "icon": m.group(3) or ""})
    return subs


ICONS = [
    (r"luat|phap", "⚖️"), (r"an toan|bao mat|mat ma", "🔐"), (r"ho chi minh|tu tuong", "⭐"),
    (r"xa hoi|chinh tri|triet|lich su|dang", "📜"), (r"toan|toi uu|giai tich|dai so|xac suat|thong ke", "📐"),
    (r"thuat toan|cau truc du lieu", "🧮"), (r"mang|phan tan|cloud|dien toan", "🌐"),
    (r"co so du lieu|du lieu|sql|data", "🗄️"), (r"tieng anh|english|toeic|ielts", "🇬🇧"),
    (r"kinh te|tai chinh|ke toan|marketing|quan tri", "📈"), (r"lap trinh|net|java|python|web|phan mem", "💻"),
    (r"vat ly", "🔭"), (r"hoa", "🧪"), (r"sinh|y hoc|duoc", "🧬"),
]


def split_icon(name: str):
    m = re.match(r"^(.*?)[\s_-]*([^\w\s()\-.,]+)$", name)
    if m and m.group(1).strip() and not re.search(r"[\wÀ-ỹ]", m.group(2)):
        return m.group(1).strip(), m.group(2)
    return name.strip(), None


def guess_icon(name: str) -> str:
    n = norm(name)
    for pat, ic in ICONS:
        if re.search(rf"\b(?:{pat})\b", n):
            return ic
    return "📘"


def find_or_make_subject(raw_name: str, subs, new_subs):
    name, icon = split_icon(raw_name.replace("_", " "))
    n = norm(name)
    for s in subs + new_subs:
        if n in (norm(s["name"]), norm(s["id"])):
            return s, False
    if re.fullmatch(r"[a-z0-9-]+", name):  # tên thư mục đã là mã môn
        sid = name
    else:
        words = n.split()
        sid = "".join(w[0] for w in words if w) if len(words) > 1 else (words[0] if words else "mon")
    base, k = sid, 2
    used = {s["id"] for s in subs + new_subs}
    while sid in used or (DATA / sid).exists() and not any(s["id"] == sid for s in subs):
        sid = f"{base}{k}"
        k += 1
    name = name[:1].upper() + name[1:]
    s = {"id": sid, "name": name, "icon": icon or guess_icon(name)}
    new_subs.append(s)
    return s, True


def chapter_from_name(stem: str):
    """'Chương 2 - Cung cầu' → (2, 'Chương 2: Cung cầu'); 'De_on_tap' → (None, 'De on tap')."""
    s = clean(stem.replace("_", " "))
    m = re.search(r"(?i)\b(?:chương|chuong|chapter|chap|ch|bài|bai|c)\s*[.\-]?\s*(\d{1,2})\b(.*)$", s)
    if not m:
        m = re.match(r"^(\d{1,2})\b(.*)$", s)
    if m:
        n = int(m.group(1))
        if re.match(r"^\s*(?:[+&,]|và|va)\s*\d{1,2}\b", m.group(2)):  # "Chương 1 + 2"
            return n, "Chương " + clean(m.group(1) + m.group(2))
        rest = re.sub(r"^[\s.:\-–—+&,]+", "", m.group(2)).strip()
        return n, f"Chương {n}: {rest}" if rest else f"Chương {n}"
    return None, s


def subject_and_chapter_for(path: Path):
    """Trả về (tên môn hoặc None, phần tên chương)."""
    rel = path.relative_to(NHAP)
    if len(rel.parts) >= 2:
        return rel.parts[0], path.stem
    m = re.match(r"(?i)^(.*?)\s*[-–—_]+\s*((?:chương|chuong|chapter|chap|ch|bài|bai)\s*\.?\s*\d.*)$", path.stem)
    if m and m.group(1).strip():
        return m.group(1).strip(), m.group(2)
    return None, path.stem


def existing_chapters(sid: str):
    d = DATA / sid
    return {int(m.group(1)) for f in d.glob("chuong*.js") if (m := re.fullmatch(r"chuong(\d+)\.js", f.name))} if d.exists() else set()


def write_chapter(sid, num, title, questions, source_name):
    d = DATA / sid
    d.mkdir(parents=True, exist_ok=True)
    body = ",\n".join("    " + json.dumps(q, ensure_ascii=False) for q in questions)
    js = (
        f"// {title}\n"
        f"// Tạo tự động từ file \"{source_name}\" — answer = vị trí đáp án đúng (0 = A, 1 = B, 2 = C, 3 = D)\n"
        f"addChapter({{\n  order: {num},\n  title: {json.dumps(title, ensure_ascii=False)},\n  questions: [\n{body}\n  ]\n}});\n"
    )
    (d / f"chuong{num}.js").write_text(js, "utf-8")


def append_subjects(new_subs):
    if not new_subs:
        return
    text = MON_JS.read_text("utf-8") if MON_JS.exists() else ""
    if text and not text.endswith("\n"):
        text += "\n"
    for s in new_subs:
        text += f'addSubject({{ id: "{s["id"]}", name: {json.dumps(s["name"], ensure_ascii=False)}, icon: "{s["icon"]}" }});\n'
    MON_JS.write_text(text, "utf-8")


# ------------------------------------------------------------------ chạy
PART_RE = re.compile(r"^(.*?)\s*\[(\d+)\]$")  # "Chương 3 - Mạng [2].png" = ảnh thứ 2 của chương 3


def collect_files():
    """Trả về các nhóm file: mỗi nhóm là 1 chương. Ảnh cùng tên, khác số [k] được gộp theo thứ tự k."""
    groups, order = {}, []
    if not NHAP.exists():
        return []
    for p in sorted(NHAP.rglob("*")):
        if not p.is_file() or p.name.startswith(".") or p.stem.lower() in BO_QUA:
            continue
        m = PART_RE.match(p.stem)
        if m and p.suffix.lower() in IMG_EXTS:
            key, k = (p.parent, m.group(1)), int(m.group(2))
        else:
            key, k = (p, None), 0
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append((k, p))
    return [[p for _, p in sorted(groups[key], key=lambda x: x[0])] for key in order]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--thu", help="đọc thử 1 file và in kết quả, không ghi gì")
    args = ap.parse_args()

    if args.thu:
        good, bad, p, n = parse_file(Path(args.thu))
        print(f"Đọc {n} dòng → {len(good)} câu hợp lệ, {len(bad)} câu bị bỏ")
        for q in good:
            print(json.dumps(q, ensure_ascii=False))
        for b in bad:
            print("BỎ:", *b)
        return 0

    subs = read_subjects()
    new_subs, ok, fail = [], [], []
    taken, files_of = {}, {}
    for paths in collect_files():
        f = paths[0]
        rel = f.relative_to(ROOT).as_posix()
        if len(paths) > 1:
            rel = f"{(f.parent / PART_RE.match(f.stem).group(1)).relative_to(ROOT).as_posix()} ({len(paths)} ảnh)"
        files_of[rel] = paths
        if f.suffix.lower() not in DUOI_HO_TRO:
            hint = " (mở bằng Word rồi Lưu thành .docx)" if f.suffix.lower() == ".doc" else ""
            fail.append((rel, f"chưa hỗ trợ định dạng {f.suffix or '(không đuôi)'}{hint}"))
            continue
        try:
            good, bad, p, nlines = parse_file(paths if len(paths) > 1 else f)
        except Exception as e:  # file hỏng, có mật khẩu…
            fail.append((rel, f"không mở được file: {e}"))
            continue
        if nlines == 0:
            fail.append((rel, "không đọc được chữ nào (ảnh mờ hoặc file trống?)"))
            continue
        if not good:
            why = bad[0][1] if bad else "không thấy câu hỏi nào (cần dạng 'Câu 1: …' và 'A. …')"
            fail.append((rel, f"không lấy được câu nào — {why}"))
            continue

        mon_name, chap_part = subject_and_chapter_for(f)
        if len(paths) > 1:
            chap_part = PART_RE.match(chap_part).group(1) if PART_RE.match(chap_part) else chap_part
        mon_name = mon_name or p.head_mon
        if not mon_name:
            fail.append((rel, "không biết thuộc môn nào — hãy để file trong thư mục nhap/<Tên môn>/ "
                              "hoặc đặt tên 'Tên môn - Chương 1.pdf'"))
            continue
        sub, is_new = find_or_make_subject(mon_name, subs, new_subs)

        num, title = chapter_from_name(chap_part)
        if num is None and p.head_chuong:
            num = p.head_chuong[0]
            title = f"Chương {num}: {p.head_chuong[1]}" if p.head_chuong[1] else f"Chương {num}"
        elif num is not None and p.head_chuong and p.head_chuong[0] == num and title == f"Chương {num}" and p.head_chuong[1]:
            title = f"Chương {num}: {p.head_chuong[1]}"
        exist = existing_chapters(sub["id"]) | taken.get(sub["id"], set())
        updated = num is not None and num in existing_chapters(sub["id"])
        if num is None:
            num = next((i for i in range(1, MAX_CHAPTER + 1) if i not in exist), None)
            if title and not title.lower().startswith(("chương", "chuong")):
                title = f"Chương {num}: {title}" if num else title
        if num is None or num > MAX_CHAPTER:
            fail.append((rel, f"số chương phải từ 1 đến {MAX_CHAPTER}"))
            continue
        if num in taken.get(sub["id"], set()):
            bad.append(("(cả file)", f"trùng số chương {num} với file khác trong cùng lần tải — file này ghi đè", ""))
        taken.setdefault(sub["id"], set()).add(num)

        write_chapter(sub["id"], num, title, good, f.name if len(paths) == 1 else rel.rsplit("/", 1)[-1])
        ok.append({"file": rel, "mon": sub, "moi": is_new, "chuong": num, "title": title,
                   "so_cau": len(good), "bo": bad, "cap_nhat": updated, "ocr": any(str(x) in OCR_USED for x in paths)})
        for x in paths:
            x.unlink()

    append_subjects(new_subs)
    for rel, _ in fail:
        for x in files_of.get(rel, [ROOT / rel]):
            try:
                x.unlink()
            except OSError:
                pass
    for d in sorted(NHAP.glob("*/"), reverse=True) if NHAP.exists() else []:
        try:
            d.rmdir()  # xóa thư mục môn đã trống
        except OSError:
            pass

    report = make_report(ok, fail)
    if ok or fail:
        (NHAP / "KET_QUA.md").write_text(report, "utf-8")
    print(report)
    summ = os.environ.get("GITHUB_STEP_SUMMARY")
    if summ:
        with open(summ, "a", encoding="utf-8") as fh:
            fh.write(report)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"loi={'1' if fail else '0'}\n")
            fh.write(f"co_thay_doi={'1' if ok else '0'}\n")
            names = ", ".join(sorted({f"{o['mon']['name']} chương {o['chuong']}" for o in ok}))
            fh.write(f"mo_ta={names}\n")
    return 0


def make_report(ok, fail):
    now = datetime.now(timezone(timedelta(hours=7))).strftime("%H:%M %d/%m/%Y")
    r = [f"# Kết quả thêm đề — {now}\n"]
    if not ok and not fail:
        r.append("Không có file nào trong `nhap/`.\n")
    for o in ok:
        tag = "🆕 môn mới, " if o["moi"] else ""
        act = "cập nhật" if o["cap_nhat"] else "thêm"
        r.append(f"## ✅ {o['file']}\n")
        r.append(f"- {tag}**{o['mon']['icon']} {o['mon']['name']}** (`data/{o['mon']['id']}/`) — {act} "
                 f"**{o['title']}** → `chuong{o['chuong']}.js`, **{o['so_cau']} câu**\n")
        if o.get("ocr"):
            r.append("- 📷 File là ảnh chụp/scan → đã đọc chữ từ ảnh (OCR), có thể sai vài dấu — nên lướt lại\n")
        if o["bo"]:
            r.append(f"- ⚠️ Bỏ qua {len(o['bo'])} câu (sửa file rồi tải lại nếu cần):\n")
            for label, why, prev in o["bo"][:30]:
                r.append(f"  - {label}: {why}" + (f" — _{prev}_" if prev else "") + "\n")
            if len(o["bo"]) > 30:
                r.append(f"  - … và {len(o['bo']) - 30} câu nữa\n")
        r.append("\n")
    for rel, why in fail:
        r.append(f"## ❌ {rel}\n- {why}\n- File đã được gỡ khỏi `nhap/`. Sửa rồi tải lại là được.\n\n")
    return "".join(r)


if __name__ == "__main__":
    sys.exit(main())
