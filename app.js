/* =========================================================
   Ôn tập trắc nghiệm — chạy hoàn toàn trên trình duyệt.
   Câu hỏi nằm trong thư mục data/, mỗi chương 1 file chuongN.js.
   Web tự dò các file data/chuong1.js … data/chuong40.js,
   nên thêm chương mới KHÔNG cần sửa file này.
   ========================================================= */

const MAX_CHAPTER = 40;
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const STORE = "ontap.v1";

const chapters = [];
function addChapter(ch) {
  if (!ch || !Array.isArray(ch.questions)) return;
  if (chapters.some(c => c.id === ch.id)) return;
  chapters.push(ch);
}
window.addChapter = addChapter;

/* ---------- Lưu trữ trên trình duyệt ---------- */
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE, JSON.stringify(store)); } catch { /* bỏ qua */ }
}
const store = loadStore();
store.settings = Object.assign(
  { mode: "practice", count: "all", shuffleQ: true, shuffleOpt: true, selected: null, theme: null },
  store.settings || {}
);
store.wrong = store.wrong || {};   // "chuong3#5": true
store.best = store.best || {};     // chapterId: % cao nhất

/* ---------- Tiện ích ---------- */
const $app = document.getElementById("app");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const keyOf = (chId, idx) => `${chId}#${idx}`;
const chapterById = id => chapters.find(c => c.id === id);
const wrongCount = chId => Object.keys(store.wrong).filter(k => k.startsWith(chId + "#")).length;

/* ---------- Giao diện sáng / tối ---------- */
function applyTheme() {
  const t = store.settings.theme ||
    (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = t;
}
document.getElementById("themeBtn").onclick = () => {
  store.settings.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  saveStore(); applyTheme();
};
document.getElementById("homeBtn").onclick = () => {
  if (session && !session.finished && session.answers.some(a => a !== null) &&
      !confirmLeave()) return;
  renderHome();
};
function confirmLeave() {
  return window.confirm("Thoát bài đang làm? Tiến độ bài này sẽ không được lưu.");
}
applyTheme();

/* ---------- Tự dò các file chương ---------- */
function loadScript(src) {
  return new Promise(resolve => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => { s.remove(); resolve(false); };
    document.head.appendChild(s);
  });
}
async function discover() {
  const jobs = [];
  for (let i = 1; i <= MAX_CHAPTER; i++) jobs.push(loadScript(`data/chuong${i}.js`));
  await Promise.all(jobs);
  chapters.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title, "vi"));
  if (!Array.isArray(store.settings.selected)) store.settings.selected = chapters.map(c => c.id);
  store.settings.selected = store.settings.selected.filter(id => chapterById(id));
  if (!store.settings.selected.length && chapters.length) store.settings.selected = [chapters[0].id];
  renderHome();
}

/* =========================================================
   TRANG CHỦ
   ========================================================= */
let session = null;

function renderHome() {
  session = null;
  const s = store.settings;
  if (!chapters.length) {
    $app.innerHTML = `<div class="card empty">
      <p><b>Chưa tìm thấy chương nào.</b></p>
      <p>Hãy đặt file câu hỏi vào thư mục <code>data/</code> với tên <code>chuong1.js</code>, <code>chuong2.js</code>…</p></div>`;
    return;
  }
  const selectedQs = chapters.filter(c => s.selected.includes(c.id))
    .reduce((n, c) => n + c.questions.length, 0);
  const totalWrong = Object.keys(store.wrong).filter(k => s.selected.includes(k.split("#")[0])).length;
  const subject = chapters[0].subject || "";

  $app.innerHTML = `
    <h1>Ôn tập ${esc(subject)}</h1>
    <p class="sub">Chọn chương muốn ôn, rồi bấm <b>Bắt đầu</b>.</p>

    <h2>Chương</h2>
    <div class="chapters">
      ${chapters.map(c => {
        const on = s.selected.includes(c.id);
        const w = wrongCount(c.id);
        const best = store.best[c.id];
        return `<label class="card chapter ${on ? "checked" : ""}">
          <input type="checkbox" data-ch="${esc(c.id)}" ${on ? "checked" : ""}>
          <div>
            <div class="name">${esc(c.title)}</div>
            <div class="meta">${c.questions.length} câu</div>
          </div>
          <div class="stat">
            ${best != null ? `Cao nhất: <b>${best}%</b><br>` : ""}
            ${w ? `<span style="color:var(--bad)">${w} câu sai</span>` : ""}
          </div>
        </label>`;
      }).join("")}
    </div>
    ${chapters.length > 1 ? `<div class="row" style="margin-top:8px">
        <button class="btn" data-act="all" style="padding:6px 12px;font-size:.85rem">Chọn tất cả</button>
        <button class="btn" data-act="none" style="padding:6px 12px;font-size:.85rem">Bỏ chọn</button>
      </div>` : ""}

    <h2>Cài đặt</h2>
    <div class="card settings">
      <div class="row">
        <span class="label">Chế độ</span>
        <div class="seg" data-set="mode">
          <button data-v="practice" class="${s.mode === "practice" ? "on" : ""}">Luyện tập</button>
          <button data-v="exam" class="${s.mode === "exam" ? "on" : ""}">Thi thử</button>
        </div>
      </div>
      <div class="row">
        <span class="label">Số câu</span>
        <div class="seg" data-set="count">
          ${["10", "20", "30", "all"].map(v =>
            `<button data-v="${v}" class="${String(s.count) === v ? "on" : ""}">${v === "all" ? "Tất cả" : v}</button>`).join("")}
        </div>
      </div>
      <div class="row">
        <span class="label">Trộn</span>
        <label class="toggle"><input type="checkbox" data-tg="shuffleQ" ${s.shuffleQ ? "checked" : ""}> Thứ tự câu hỏi</label>
        <label class="toggle"><input type="checkbox" data-tg="shuffleOpt" ${s.shuffleOpt ? "checked" : ""}> Thứ tự đáp án</label>
      </div>
    </div>
    <p class="hint">${s.mode === "practice"
      ? "Luyện tập: chọn xong là biết đúng/sai ngay."
      : "Thi thử: làm hết rồi nộp bài mới xem điểm."}</p>

    <div class="actions">
      <button class="btn primary grow" data-act="start" ${selectedQs ? "" : "disabled"}>▶ Bắt đầu (${selectedQs} câu)</button>
      <button class="btn grow" data-act="wrong" ${totalWrong ? "" : "disabled"}>🔁 Ôn câu sai (${totalWrong})</button>
      <button class="btn grow" data-act="browse" ${selectedQs ? "" : "disabled"}>📖 Xem đáp án</button>
    </div>
    ${totalWrong ? `<p class="hint"><a href="#" data-act="clearWrong" style="color:var(--muted)">Xóa danh sách câu sai</a></p>` : ""}
  `;

  $app.querySelectorAll("[data-ch]").forEach(cb => cb.onchange = () => {
    const id = cb.dataset.ch;
    s.selected = cb.checked ? [...new Set([...s.selected, id])] : s.selected.filter(x => x !== id);
    saveStore(); renderHome();
  });
  $app.querySelectorAll("[data-set] button").forEach(b => b.onclick = () => {
    s[b.parentElement.dataset.set] = b.dataset.v; saveStore(); renderHome();
  });
  $app.querySelectorAll("[data-tg]").forEach(cb => cb.onchange = () => {
    s[cb.dataset.tg] = cb.checked; saveStore();
  });
  $app.querySelectorAll("[data-act]").forEach(b => b.onclick = e => {
    e.preventDefault();
    const a = b.dataset.act;
    if (a === "all") { s.selected = chapters.map(c => c.id); saveStore(); renderHome(); }
    if (a === "none") { s.selected = []; saveStore(); renderHome(); }
    if (a === "start") startQuiz(false);
    if (a === "wrong") startQuiz(true);
    if (a === "browse") renderBrowse();
    if (a === "clearWrong" && confirm("Xóa toàn bộ danh sách câu sai?")) {
      Object.keys(store.wrong).forEach(k => { if (s.selected.includes(k.split("#")[0])) delete store.wrong[k]; });
      saveStore(); renderHome();
    }
  });
}

/* =========================================================
   LÀM BÀI
   ========================================================= */
function buildItems(onlyWrong) {
  const s = store.settings;
  let items = [];
  chapters.filter(c => s.selected.includes(c.id)).forEach(c => {
    c.questions.forEach((q, idx) => {
      if (onlyWrong && !store.wrong[keyOf(c.id, idx)]) return;
      let opts = q.options.map((text, orig) => ({ text, orig }));
      if (s.shuffleOpt) opts = shuffle(opts);
      items.push({
        chId: c.id, chTitle: c.title, idx, q: q.q, note: q.note,
        opts, answerPos: opts.findIndex(o => o.orig === q.answer),
      });
    });
  });
  if (s.shuffleQ) items = shuffle(items);
  if (!onlyWrong && s.count !== "all") items = items.slice(0, Number(s.count));
  return items;
}

function startQuiz(onlyWrong) {
  const items = buildItems(onlyWrong);
  if (!items.length) return;
  session = {
    items, onlyWrong,
    mode: onlyWrong ? "practice" : store.settings.mode,
    answers: items.map(() => null),
    cur: 0, finished: false,
  };
  renderQuiz();
}

function correctSoFar() {
  return session.answers.reduce((n, a, i) => n + (a !== null && a === session.items[i].answerPos ? 1 : 0), 0);
}

function renderQuiz() {
  const S = session, it = S.items[S.cur], picked = S.answers[S.cur];
  const practice = S.mode === "practice";
  const locked = practice && picked !== null;
  const answeredN = S.answers.filter(a => a !== null).length;
  const multiChapter = new Set(S.items.map(i => i.chId)).size > 1;
  const isLast = S.cur === S.items.length - 1;

  $app.innerHTML = `
    <div class="quiz-head">
      <span>Câu <b>${S.cur + 1}</b> / ${S.items.length}${S.onlyWrong ? " · Ôn câu sai" : ""}</span>
      ${practice ? `<span class="score-pill">✔ ${correctSoFar()} / ${answeredN}</span>`
                 : `<span class="score-pill">Đã làm ${answeredN}/${S.items.length}</span>`}
    </div>
    <div class="progress"><div style="width:${(answeredN / S.items.length) * 100}%"></div></div>

    <div class="card">
      ${multiChapter ? `<span class="tag">${esc(it.chTitle)}</span>` : ""}
      <p class="question">${esc(it.q)}</p>
      <div class="options">
        ${it.opts.map((o, i) => {
          let cls = "";
          if (locked) {
            if (i === it.answerPos) cls = "correct";
            else if (i === picked) cls = "wrong";
          } else if (i === picked) cls = "picked";
          return `<button class="opt ${cls}" data-i="${i}" ${locked ? "disabled" : ""}>
            <span class="key">${LETTERS[i]}</span><span>${esc(o.text)}</span></button>`;
        }).join("")}
      </div>
      ${locked ? (picked === it.answerPos
        ? `<div class="feedback ok">✔ Chính xác!</div>`
        : `<div class="feedback bad">✘ Sai rồi. Đáp án đúng: ${LETTERS[it.answerPos]}</div>`) : ""}
      ${locked && it.note ? `<div class="note">💡 ${esc(it.note)}</div>` : ""}
    </div>

    <div class="nav">
      <button class="btn" data-nav="prev" ${S.cur === 0 ? "disabled" : ""}>← Trước</button>
      ${isLast
        ? `<button class="btn primary grow" data-nav="finish">${practice ? "Xem kết quả" : "Nộp bài"}</button>`
        : `<button class="btn primary grow" data-nav="next">Tiếp →</button>`}
    </div>

    <div class="grid">
      ${S.items.map((x, i) => {
        const a = S.answers[i];
        let c = "";
        if (a !== null) c = practice ? (a === x.answerPos ? "g-ok" : "g-bad") : "answered";
        return `<button class="${c} ${i === S.cur ? "current" : ""}" data-go="${i}">${i + 1}</button>`;
      }).join("")}
    </div>
    <p class="hint">Phím tắt: <b>1–4</b> hoặc <b>A–D</b> để chọn, <b>←</b> <b>→</b> để chuyển câu.</p>
  `;

  $app.querySelectorAll(".opt").forEach(b => b.onclick = () => pick(Number(b.dataset.i)));
  $app.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { S.cur = Number(b.dataset.go); renderQuiz(); });
  $app.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => nav(b.dataset.nav));
}

function pick(i) {
  const S = session;
  if (!S || S.finished) return;
  const it = S.items[S.cur];
  if (i < 0 || i >= it.opts.length) return;
  if (S.mode === "practice") {
    if (S.answers[S.cur] !== null) return;
    S.answers[S.cur] = i;
    markWrong(it, i);
  } else {
    S.answers[S.cur] = i;
  }
  renderQuiz();
}

function markWrong(it, picked) {
  const k = keyOf(it.chId, it.idx);
  if (picked === it.answerPos) delete store.wrong[k];
  else store.wrong[k] = true;
  saveStore();
}

function nav(dir) {
  const S = session;
  if (dir === "prev" && S.cur > 0) S.cur--;
  else if (dir === "next" && S.cur < S.items.length - 1) S.cur++;
  else if (dir === "finish") return finish();
  renderQuiz();
  window.scrollTo({ top: 0 });
}

function finish() {
  const S = session;
  const left = S.answers.filter(a => a === null).length;
  if (left && !confirm(`Còn ${left} câu chưa làm. Vẫn ${S.mode === "exam" ? "nộp bài" : "xem kết quả"}?`)) return;
  if (S.mode === "exam") S.items.forEach((it, i) => { if (S.answers[i] !== null) markWrong(it, S.answers[i]); });
  S.finished = true;

  // Lưu điểm cao nhất khi làm trọn 1 chương
  const total = S.items.length, right = correctSoFar();
  const pct = Math.round((right / total) * 100);
  const chIds = [...new Set(S.items.map(i => i.chId))];
  if (!S.onlyWrong && chIds.length === 1 && total === chapterById(chIds[0]).questions.length) {
    store.best[chIds[0]] = Math.max(store.best[chIds[0]] || 0, pct);
    saveStore();
  }
  renderResult("wrong");
}

/* =========================================================
   KẾT QUẢ
   ========================================================= */
function renderResult(filter) {
  const S = session, total = S.items.length, right = correctSoFar();
  const pct = Math.round((right / total) * 100);
  const score10 = (right / total * 10).toFixed(1).replace(/\.0$/, "");
  const msg = pct >= 90 ? "Xuất sắc! 🎉" : pct >= 70 ? "Tốt lắm! 👍" : pct >= 50 ? "Tạm ổn, ôn thêm chút nữa nhé." : "Cần ôn lại nhiều hơn 💪";
  const wrongN = total - right;

  const list = S.items.map((it, i) => ({ it, a: S.answers[i], i }))
    .filter(x => filter === "all" || x.a !== x.it.answerPos);

  $app.innerHTML = `
    <div class="card result-hero">
      <div class="big-score">${right}<small> / ${total}</small></div>
      <p style="margin:6px 0 0;font-size:1.1rem"><b>${score10} điểm</b> · ${pct}%</p>
      <p class="sub" style="margin-top:6px">${msg}</p>
    </div>

    <div class="actions">
      <button class="btn primary grow" data-r="again">🔄 Làm lại</button>
      <button class="btn grow" data-r="wrong" ${Object.keys(store.wrong).length ? "" : "disabled"}>🔁 Ôn câu sai</button>
      <button class="btn grow" data-r="home">🏠 Trang chủ</button>
    </div>

    <div class="row filter">
      <div class="seg">
        <button data-f="wrong" class="${filter === "wrong" ? "on" : ""}">Câu sai / bỏ trống (${wrongN})</button>
        <button data-f="all" class="${filter === "all" ? "on" : ""}">Tất cả (${total})</button>
      </div>
    </div>

    <div class="review">
      ${list.length ? list.map(({ it, a, i }) => `
        <div class="card">
          <div class="q">${i + 1}. ${esc(it.q)}</div>
          ${a === null
            ? `<div class="line bad">Bạn bỏ trống</div>`
            : a !== it.answerPos
              ? `<div class="line bad">✘ Bạn chọn: ${LETTERS[a]}. ${esc(it.opts[a].text)}</div>`
              : ""}
          <div class="line ok">✔ Đáp án: ${LETTERS[it.answerPos]}. ${esc(it.opts[it.answerPos].text)}</div>
          ${it.note ? `<div class="note">💡 ${esc(it.note)}</div>` : ""}
        </div>`).join("")
      : `<div class="card empty">Không sai câu nào. Giỏi quá! 🎉</div>`}
    </div>
  `;
  $app.querySelectorAll("[data-f]").forEach(b => b.onclick = () => renderResult(b.dataset.f));
  $app.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
    const r = b.dataset.r;
    if (r === "again") startQuiz(S.onlyWrong);
    if (r === "wrong") startQuiz(true);
    if (r === "home") renderHome();
  });
  window.scrollTo({ top: 0 });
}

/* =========================================================
   XEM ĐÁP ÁN (đọc lại toàn bộ đề)
   ========================================================= */
function renderBrowse(query = "") {
  session = null;
  const sel = chapters.filter(c => store.settings.selected.includes(c.id));
  const norm = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const nq = norm(query.trim());

  const blocks = sel.map(c => {
    const qs = c.questions.map((q, idx) => ({ q, idx }))
      .filter(({ q }) => !nq || norm(q.q + " " + q.options.join(" ")).includes(nq));
    if (!qs.length) return "";
    return `<h2>${esc(c.title)}</h2>` + qs.map(({ q, idx }) => `
      <div class="card browse-item">
        <b>Câu ${idx + 1}.</b> <span style="white-space:pre-line">${esc(q.q)}</span>
        <ol>${q.options.map((o, i) => `<li class="${i === q.answer ? "ans" : ""}">${esc(o)}${i === q.answer ? " ✔" : ""}</li>`).join("")}</ol>
        ${q.note ? `<div class="note">💡 ${esc(q.note)}</div>` : ""}
      </div>`).join("");
  }).join("");

  const focused = document.activeElement && document.activeElement.id === "search";
  $app.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <h1 style="margin:0">Xem đáp án</h1>
      <button class="btn" id="back">← Trang chủ</button>
    </div>
    <input class="search" id="search" placeholder="🔍 Tìm câu hỏi (gõ không dấu cũng được)…" value="${esc(query)}">
    ${blocks || `<div class="card empty">Không tìm thấy câu nào.</div>`}
  `;
  document.getElementById("back").onclick = renderHome;
  const box = document.getElementById("search");
  box.oninput = () => renderBrowse(box.value);
  if (focused || query) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
}

/* ---------- Phím tắt ---------- */
document.addEventListener("keydown", e => {
  if (!session || session.finished) return;
  if (e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (/^[1-8]$/.test(k)) pick(Number(k) - 1);
  else if (/^[a-h]$/.test(k)) pick(k.charCodeAt(0) - 97);
  else if (k === "arrowright") {
    session.cur === session.items.length - 1 ? nav("finish") : nav("next");
  } else if (k === "arrowleft") nav("prev");
});

window.addEventListener("beforeunload", e => {
  if (session && !session.finished && session.answers.some(a => a !== null)) { e.preventDefault(); e.returnValue = ""; }
});

discover();
