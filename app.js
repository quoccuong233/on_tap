/* =========================================================
   Ôn tập trắc nghiệm — chạy hoàn toàn trên trình duyệt.
   - Danh sách môn nằm trong data/mon.js
   - Mỗi môn có 1 thư mục: data/<mã-môn>/chuong1.js … chuong40.js
   Web tự dò các file chương, nên thêm chương mới KHÔNG cần sửa file này.
   ========================================================= */

const MAX_CHAPTER = 40;
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const STORE = "ontap.v1";

const subjects = [];
function addSubject(sub) {
  if (!sub || !sub.id || subjects.some(x => x.id === sub.id)) return;
  subjects.push(sub);
}
const chapters = [];
function addChapter(ch) {
  if (!ch || !Array.isArray(ch.questions)) return;
  // Lấy mã môn từ đường dẫn file: data/<mã-môn>/chuongN.js
  const src = (document.currentScript && document.currentScript.src) || "";
  const m = src.match(/data\/([^/]+)\/([^/]+)\.js(\?|$)/);
  const subj = m ? decodeURIComponent(m[1]) : "khac";
  const file = m ? m[2] : (ch.id || "chuong");
  ch.subj = subj;
  ch.id = `${subj}/${file}`;
  if (chapters.some(c => c.id === ch.id)) return;
  chapters.push(ch);
}
window.addSubject = addSubject;
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
  { mode: "practice", count: "all", shuffleQ: true, shuffleOpt: true, selected: [], subject: null, seen: {}, theme: null },
  store.settings || {}
);
store.wrong = store.wrong || {};   // "pldc/chuong3#5": true
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
const curSubject = () => subjects.find(x => x.id === store.settings.subject) || subjects[0];
const curChapters = () => chapters.filter(c => curSubject() && c.subj === curSubject().id);
const wrongCount = chId => Object.keys(store.wrong).filter(k => k.startsWith(chId + "#")).length;
const toTop = () => window.scrollTo({ top: 0 });

/* Tách "Chương 3: Tên chương" thành nhãn + tên */
function splitTitle(t) {
  const m = String(t).match(/^\s*(Chương\s*[\d+\s]+?)\s*[:.–-]\s*(.+)$/i);
  return m ? { label: m[1].replace(/\s+/g, " ").trim(), name: m[2] } : { label: "", name: t };
}

/* ---------- Hộp thoại xác nhận (thay cho confirm) ---------- */
const $modal = document.getElementById("modal");
function ask(msg, yes = "Đồng ý", no = "Ở lại") {
  return new Promise(resolve => {
    document.getElementById("modalMsg").textContent = msg;
    const by = document.getElementById("modalYes"), bn = document.getElementById("modalNo");
    by.textContent = yes; bn.textContent = no;
    $modal.hidden = false;
    requestAnimationFrame(() => $modal.classList.add("show"));
    by.focus();
    const done = v => {
      $modal.classList.remove("show");
      $modal.hidden = true;
      by.onclick = bn.onclick = $modal.onclick = null;
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = e => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); done(false); }
      if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); done(true); }
    };
    by.onclick = () => done(true);
    bn.onclick = () => done(false);
    $modal.onclick = e => { if (e.target === $modal) done(false); };
    document.addEventListener("keydown", onKey, true);
  });
}
const modalOpen = () => !$modal.hidden;

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
document.getElementById("homeBtn").onclick = () => exitQuiz();
applyTheme();

const inProgress = () => session && !session.finished && session.answers.some(a => a !== null);
async function exitQuiz() {
  if (inProgress()) {
    const ok = await ask("Thoát bài đang làm? Kết quả bài này sẽ không được tính.", "Thoát", "Làm tiếp");
    if (!ok) return;
  }
  renderHome();
  toTop();
}

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
  await loadScript("data/mon.js");
  const jobs = [];
  subjects.forEach(sub => {
    for (let i = 1; i <= MAX_CHAPTER; i++) jobs.push(loadScript(`data/${encodeURIComponent(sub.id)}/chuong${i}.js`));
  });
  await Promise.all(jobs);
  chapters.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title, "vi"));
  const s = store.settings;
  if (!Array.isArray(s.selected)) s.selected = [];
  s.selected = s.selected.filter(id => chapterById(id));
  if (!subjects.some(x => x.id === s.subject)) s.subject = subjects[0] ? subjects[0].id : null;
  renderHome();
}

function switchSubject(id) {
  const s = store.settings;
  s.subject = id;
  // Lần đầu mở môn này: chọn sẵn tất cả các chương
  if (!s.seen[id]) {
    s.seen[id] = true;
    s.selected = [...new Set([...s.selected, ...curChapters().map(c => c.id)])];
  }
  saveStore();
  renderHome();
}

/* =========================================================
   TRANG CHỦ
   ========================================================= */
let session = null;

/* Số câu thật sự sẽ làm khi bấm Bắt đầu */
function plannedCount(available) {
  const c = store.settings.count;
  return c === "all" ? available : Math.min(Number(c), available);
}

function renderHome() {
  session = null;
  document.body.classList.remove("quizzing");
  const s = store.settings;
  if (!subjects.length) {
    $app.innerHTML = `<div class="card empty">
      <p><b>Chưa có môn nào.</b></p>
      <p>Kiểm tra file <code>data/mon.js</code> đã được upload chưa.</p></div>`;
    return;
  }
  const sub = curSubject();
  if (!s.seen[sub.id]) return switchSubject(sub.id);
  const list = curChapters();
  const subjTotal = list.reduce((n, c) => n + c.questions.length, 0);

  const subjectPicker = subjects.length > 1 ? `
    <div class="subjects">
      ${subjects.map(x => {
        const chs = chapters.filter(c => c.subj === x.id);
        const nq = chs.reduce((n, c) => n + c.questions.length, 0);
        return `<button class="subject ${x.id === sub.id ? "on" : ""}" data-sub="${esc(x.id)}">
          <span class="sicon">${esc(x.icon || "📘")}</span>
          <span class="stext"><b>${esc(x.name)}</b><small>${chs.length} chương · ${nq} câu</small></span>
        </button>`;
      }).join("")}
    </div>` : "";

  if (!list.length) {
    $app.innerHTML = `${subjectPicker}
      <section class="hero"><div class="hero-icon">${esc(sub.icon || "📘")}</div>
        <div><h1>${esc(sub.name)}</h1><p class="sub">Môn này chưa có chương nào.</p></div></section>
      <div class="card empty">
      <p>Đặt file câu hỏi vào thư mục <code>data/${esc(sub.id)}/</code> với tên <code>chuong1.js</code>, <code>chuong2.js</code>…</p></div>`;
    $app.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => switchSubject(b.dataset.sub));
    return;
  }
  const selList = list.filter(c => s.selected.includes(c.id));
  const selectedQs = selList.reduce((n, c) => n + c.questions.length, 0);
  const selIds = selList.map(c => c.id);
  const totalWrong = Object.keys(store.wrong).filter(k => selIds.includes(k.split("#")[0])).length;
  const subjWrong = Object.keys(store.wrong).filter(k => list.some(c => k.startsWith(c.id + "#"))).length;
  const willDo = plannedCount(selectedQs);
  const allOn = selList.length === list.length;

  $app.innerHTML = `
    ${subjectPicker}

    <section class="hero">
      <div class="hero-icon">${esc(sub.icon || "📘")}</div>
      <div class="hero-text">
        <h1>${esc(sub.name)}</h1>
        <div class="chips">
          <span class="chip">📚 ${list.length} chương</span>
          <span class="chip">📝 ${subjTotal} câu</span>
          ${subjWrong ? `<span class="chip bad">✘ ${subjWrong} câu sai cần ôn</span>` : ""}
        </div>
      </div>
    </section>

    <div class="section-head">
      <h2>Chọn chương</h2>
      ${list.length > 1 ? `<button class="link-btn" data-act="${allOn ? "none" : "all"}">${allOn ? "Bỏ chọn tất cả" : "Chọn tất cả"}</button>` : ""}
    </div>
    <div class="chapters">
      ${list.map(c => {
        const on = s.selected.includes(c.id);
        const w = wrongCount(c.id);
        const best = store.best[c.id];
        const t = splitTitle(c.title);
        return `<label class="chapter ${on ? "checked" : ""}">
          <input type="checkbox" data-ch="${esc(c.id)}" ${on ? "checked" : ""}>
          <span class="tick" aria-hidden="true"></span>
          <span class="ch-body">
            ${t.label ? `<span class="ch-label">${esc(t.label)}</span>` : ""}
            <span class="ch-name">${esc(t.name)}</span>
            <span class="ch-meta">
              <span>${c.questions.length} câu</span>
              ${best != null ? `<span class="ok-text">Cao nhất ${best}%</span>` : ""}
              ${w ? `<span class="bad-text">${w} câu sai</span>` : ""}
            </span>
            ${best != null ? `<span class="minibar"><span style="width:${best}%"></span></span>` : ""}
          </span>
        </label>`;
      }).join("")}
    </div>

    <h2>Cài đặt</h2>
    <div class="card settings">
      <div class="set-row">
        <span class="label">Chế độ</span>
        <div class="seg" data-set="mode">
          <button data-v="practice" class="${s.mode === "practice" ? "on" : ""}">🎯 Luyện tập</button>
          <button data-v="exam" class="${s.mode === "exam" ? "on" : ""}">⏱ Thi thử</button>
        </div>
      </div>
      <div class="set-row">
        <span class="label">Số câu</span>
        <div class="seg" data-set="count">
          ${["10", "20", "30", "all"].map(v =>
            `<button data-v="${v}" class="${String(s.count) === v ? "on" : ""}">${v === "all" ? "Tất cả" : v}</button>`).join("")}
        </div>
      </div>
      <div class="set-row">
        <span class="label">Trộn</span>
        <div class="toggles">
          <label class="toggle"><input type="checkbox" data-tg="shuffleQ" ${s.shuffleQ ? "checked" : ""}><span class="sw"></span>Thứ tự câu hỏi</label>
          <label class="toggle"><input type="checkbox" data-tg="shuffleOpt" ${s.shuffleOpt ? "checked" : ""}><span class="sw"></span>Thứ tự đáp án</label>
        </div>
      </div>
      <p class="hint">${s.mode === "practice"
        ? "🎯 Luyện tập: chọn xong là biết đúng/sai ngay, có giải thích nếu có."
        : "⏱ Thi thử: làm hết rồi nộp bài mới xem điểm (thang 10)."}</p>
    </div>

    <div class="start-bar">
      <div class="start-info">
        ${selectedQs
          ? `<b>${willDo} câu</b><span>${willDo < selectedQs
              ? `${s.shuffleQ ? "ngẫu nhiên" : "đầu tiên"} trong ${selectedQs} câu · ${selList.length} chương`
              : `${selList.length} chương đã chọn`}</span>`
          : `<b>Chưa chọn chương</b><span>Hãy chọn ít nhất 1 chương</span>`}
      </div>
      <button class="btn primary big" data-act="start" ${selectedQs ? "" : "disabled"}>▶ Bắt đầu (${willDo} câu)</button>
    </div>
    <div class="actions">
      <button class="btn grow" data-act="wrong" ${totalWrong ? "" : "disabled"}>🔁 Ôn câu sai (${totalWrong})</button>
      <button class="btn grow" data-act="browse" ${selectedQs ? "" : "disabled"}>📖 Xem đáp án</button>
    </div>
    ${totalWrong ? `<p class="hint center"><button class="link-btn muted" data-act="clearWrong">Xóa danh sách câu sai</button></p>` : ""}
  `;

  $app.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => switchSubject(b.dataset.sub));
  $app.querySelectorAll("[data-ch]").forEach(cb => cb.onchange = () => {
    const id = cb.dataset.ch;
    s.selected = cb.checked ? [...new Set([...s.selected, id])] : s.selected.filter(x => x !== id);
    saveStore(); renderHome();
  });
  $app.querySelectorAll("[data-set] button").forEach(b => b.onclick = () => {
    s[b.parentElement.dataset.set] = b.dataset.v; saveStore(); renderHome();
  });
  $app.querySelectorAll("[data-tg]").forEach(cb => cb.onchange = () => {
    s[cb.dataset.tg] = cb.checked; saveStore(); renderHome();
  });
  $app.querySelectorAll("[data-act]").forEach(b => b.onclick = async e => {
    e.preventDefault();
    const a = b.dataset.act;
    if (a === "all") { s.selected = [...new Set([...s.selected, ...list.map(c => c.id)])]; saveStore(); renderHome(); }
    if (a === "none") { s.selected = s.selected.filter(id => !list.some(c => c.id === id)); saveStore(); renderHome(); }
    if (a === "start") startQuiz(false);
    if (a === "wrong") startQuiz(true);
    if (a === "browse") { renderBrowse(); toTop(); }
    if (a === "clearWrong" && await ask("Xóa toàn bộ danh sách câu sai của các chương đang chọn?", "Xóa", "Hủy")) {
      Object.keys(store.wrong).forEach(k => { if (selIds.includes(k.split("#")[0])) delete store.wrong[k]; });
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
  curChapters().filter(c => s.selected.includes(c.id)).forEach(c => {
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
  if (!onlyWrong) items = items.slice(0, plannedCount(items.length));
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
  toTop();
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
  const pct = (answeredN / S.items.length) * 100;
  document.body.classList.add("quizzing");

  $app.innerHTML = `
    <div class="quiz-top">
      <button class="btn ghost small" data-nav="exit" title="Thoát bài (Esc)">✕ Thoát</button>
      <div class="quiz-title">
        <span class="mode-badge ${practice ? "" : "exam"}">${S.onlyWrong ? "🔁 Ôn câu sai" : practice ? "🎯 Luyện tập" : "⏱ Thi thử"}</span>
        <span class="counter">Câu <b>${S.cur + 1}</b>/${S.items.length}</span>
      </div>
      ${practice
        ? `<span class="score-pill">✔ ${correctSoFar()}/${answeredN}</span>`
        : `<button class="btn primary small" data-nav="finish">Nộp bài</button>`}
    </div>
    <div class="progress" title="Đã làm ${answeredN}/${S.items.length}"><div style="width:${pct}%"></div></div>

    <div class="card qcard">
      ${multiChapter ? `<span class="tag">${esc(splitTitle(it.chTitle).label || it.chTitle)}</span>` : ""}
      <p class="question">${esc(it.q)}</p>
      <div class="options">
        ${it.opts.map((o, i) => {
          let cls = "";
          if (locked) {
            if (i === it.answerPos) cls = "correct";
            else if (i === picked) cls = "wrong";
            else cls = "dim";
          } else if (i === picked) cls = "picked";
          return `<button class="opt ${cls}" data-i="${i}" ${locked ? "disabled" : ""}>
            <span class="key">${LETTERS[i]}</span><span class="otext">${esc(o.text)}</span></button>`;
        }).join("")}
      </div>
      ${locked ? (picked === it.answerPos
        ? `<div class="feedback ok">✔ Chính xác!</div>`
        : `<div class="feedback bad">✘ Chưa đúng. Đáp án đúng là <b>${LETTERS[it.answerPos]}</b>.</div>`) : ""}
      ${locked && it.note ? `<div class="note">💡 ${esc(it.note)}</div>` : ""}
    </div>

    <div class="nav">
      <button class="btn" data-nav="prev" ${S.cur === 0 ? "disabled" : ""}>← Trước</button>
      ${isLast
        ? `<button class="btn primary grow" data-nav="finish">${practice ? "Xem kết quả" : "Nộp bài"}</button>`
        : `<button class="btn primary grow" data-nav="next">Tiếp →</button>`}
    </div>

    <details class="grid-wrap" ${S.items.length <= 60 ? "open" : ""}>
      <summary>Danh sách câu <span class="muted">(${answeredN}/${S.items.length} đã làm)</span></summary>
      <div class="grid">
        ${S.items.map((x, i) => {
          const a = S.answers[i];
          let c = "";
          if (a !== null) c = practice ? (a === x.answerPos ? "g-ok" : "g-bad") : "answered";
          return `<button class="${c} ${i === S.cur ? "current" : ""}" data-go="${i}">${i + 1}</button>`;
        }).join("")}
      </div>
    </details>
    <p class="hint">Phím tắt: <kbd>1</kbd>–<kbd>4</kbd> hoặc <kbd>A</kbd>–<kbd>D</kbd> để chọn · <kbd>←</kbd> <kbd>→</kbd> chuyển câu · <kbd>Esc</kbd> thoát</p>
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
  if (!S) return;
  if (dir === "exit") return exitQuiz();
  if (dir === "finish") return finish();
  if (dir === "prev" && S.cur > 0) S.cur--;
  else if (dir === "next" && S.cur < S.items.length - 1) S.cur++;
  else return;
  renderQuiz();
  toTop();
}

async function finish() {
  const S = session;
  const left = S.answers.filter(a => a === null).length;
  if (left && !await ask(`Còn ${left} câu chưa làm. Vẫn ${S.mode === "exam" ? "nộp bài" : "xem kết quả"}?`,
                         S.mode === "exam" ? "Nộp bài" : "Xem kết quả", "Làm tiếp")) return;
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
  const blank = S.answers.filter(a => a === null).length;
  const wrongN = total - right;
  const tone = pct >= 70 ? "good" : pct >= 50 ? "mid" : "low";
  document.body.classList.remove("quizzing");

  const list = S.items.map((it, i) => ({ it, a: S.answers[i], i }))
    .filter(x => filter === "all" || x.a !== x.it.answerPos);

  $app.innerHTML = `
    <div class="card result-hero ${tone}">
      <div class="ring" style="--p:${pct}"><div class="ring-in"><b>${score10}</b><small>điểm</small></div></div>
      <div class="result-text">
        <h1>${msg}</h1>
        <div class="chips">
          <span class="chip ok">✔ ${right} đúng</span>
          <span class="chip bad">✘ ${wrongN - blank} sai</span>
          ${blank ? `<span class="chip">○ ${blank} bỏ trống</span>` : ""}
          <span class="chip">${pct}%</span>
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="btn primary grow" data-r="again">🔄 Làm lại</button>
      <button class="btn grow" data-r="wrong" ${buildItems(true).length ? "" : "disabled"}>🔁 Ôn câu sai</button>
      <button class="btn grow" data-r="home">🏠 Trang chủ</button>
    </div>

    <div class="section-head">
      <h2>Xem lại</h2>
      <div class="seg small">
        <button data-f="wrong" class="${filter === "wrong" ? "on" : ""}">Sai / bỏ trống (${wrongN})</button>
        <button data-f="all" class="${filter === "all" ? "on" : ""}">Tất cả (${total})</button>
      </div>
    </div>

    <div class="review">
      ${list.length ? list.map(({ it, a, i }) => `
        <div class="card rv ${a === it.answerPos ? "rv-ok" : "rv-bad"}">
          <div class="q"><span class="qn">${i + 1}</span>${esc(it.q)}</div>
          ${a === null
            ? `<div class="line bad">○ Bạn bỏ trống</div>`
            : a !== it.answerPos
              ? `<div class="line bad">✘ Bạn chọn ${LETTERS[a]}. ${esc(it.opts[a].text)}</div>`
              : ""}
          <div class="line ok">✔ Đáp án ${LETTERS[it.answerPos]}. ${esc(it.opts[it.answerPos].text)}</div>
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
    if (r === "home") { renderHome(); toTop(); }
  });
  toTop();
}

/* =========================================================
   XEM ĐÁP ÁN (đọc lại toàn bộ đề)
   ========================================================= */
function renderBrowse(query = "") {
  session = null;
  document.body.classList.remove("quizzing");
  const sel = curChapters().filter(c => store.settings.selected.includes(c.id));
  const norm = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const nq = norm(query.trim());
  let found = 0;

  const blocks = sel.map(c => {
    const qs = c.questions.map((q, idx) => ({ q, idx }))
      .filter(({ q }) => !nq || norm(q.q + " " + q.options.join(" ")).includes(nq));
    if (!qs.length) return "";
    found += qs.length;
    return `<h2 class="browse-h">${esc(c.title)}</h2>` + qs.map(({ q, idx }) => `
      <div class="card browse-item">
        <div class="q"><span class="qn">${idx + 1}</span><span style="white-space:pre-line">${esc(q.q)}</span></div>
        <ol>${q.options.map((o, i) => `<li class="${i === q.answer ? "ans" : ""}"><span class="key">${LETTERS[i]}</span><span>${esc(o)}</span></li>`).join("")}</ol>
        ${q.note ? `<div class="note">💡 ${esc(q.note)}</div>` : ""}
      </div>`).join("");
  }).join("");

  const focused = document.activeElement && document.activeElement.id === "search";
  $app.innerHTML = `
    <div class="browse-top">
      <button class="btn ghost small" id="back">← Trang chủ</button>
      <div>
        <h1>Xem đáp án</h1>
        <p class="sub">${esc(curSubject().name)} · ${found} câu${nq ? " khớp" : ""}</p>
      </div>
    </div>
    <div class="search-wrap"><input class="search" id="search" placeholder="Tìm câu hỏi (gõ không dấu cũng được)…" value="${esc(query)}"></div>
    ${blocks || `<div class="card empty">Không tìm thấy câu nào.</div>`}
  `;
  document.getElementById("back").onclick = () => { renderHome(); toTop(); };
  const box = document.getElementById("search");
  box.oninput = () => renderBrowse(box.value);
  if (focused || query) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
}

/* ---------- Phím tắt ---------- */
document.addEventListener("keydown", e => {
  if (modalOpen()) return;
  if (!session || session.finished) return;
  if (e.target.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "escape") { e.preventDefault(); exitQuiz(); }
  else if (/^[1-8]$/.test(k)) pick(Number(k) - 1);
  else if (/^[a-h]$/.test(k)) pick(k.charCodeAt(0) - 97);
  else if (k === "arrowright") {
    session.cur === session.items.length - 1 ? nav("finish") : nav("next");
  } else if (k === "arrowleft") nav("prev");
});

window.addEventListener("beforeunload", e => {
  if (inProgress()) { e.preventDefault(); e.returnValue = ""; }
});

discover();
