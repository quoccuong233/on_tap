/* =========================================================
   Trang "Thêm đề": chọn môn + chọn file → tải file lên thư mục nhap/ của repo
   (1 commit qua GitHub API) → GitHub Actions tự chuyển đề thành câu hỏi
   và đưa web lên lại. Trang này theo dõi tiến trình rồi hiện kết quả.
   ========================================================= */

/* Tự nhận repo từ địa chỉ web: <chủ>.github.io/<repo>/ */
const OWNER = location.hostname.endsWith(".github.io") ? location.hostname.split(".")[0] : "quoccuong233";
const REPO = location.hostname.endsWith(".github.io") ? (location.pathname.split("/")[1] || "on_tap") : "on_tap";
const BRANCH = "main";
const TOKEN_KEY = "ontap.ghtoken";
const BUST_KEY = "ontap.bust";
const EXTS = [".pdf", ".docx", ".txt"];
const EMOJIS = ["📘", "📐", "🧮", "💻", "🗄️", "🌐", "🔐", "📈", "⚖️", "📜", "🧪", "🧬", "🇬🇧", "🎵", "⭐", "🚩"];

const $app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Giao diện sáng/tối (dùng chung cài đặt với trang ôn tập) ---------- */
function loadStore() { try { return JSON.parse(localStorage.getItem("ontap.v1")) || {}; } catch { return {}; } }
function applyTheme() {
  const st = loadStore();
  const t = (st.settings && st.settings.theme) ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = t;
}
applyTheme();
document.getElementById("themeBtn").onclick = () => {
  const st = loadStore();
  st.settings = st.settings || {};
  st.settings.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("ontap.v1", JSON.stringify(st)); } catch { }
  applyTheme();
};

/* ---------- GitHub API ---------- */
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { }

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    cache: "no-store",
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json()).message || ""; } catch { }
    const e = new Error(`GitHub báo lỗi ${res.status}${msg ? `: ${msg}` : ""}`);
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}
const repoPath = p => `/repos/${OWNER}/${REPO}${p}`;

function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error(`Không đọc được file ${file.name}`));
    r.readAsDataURL(file);
  });
}

/* ---------- Dữ liệu môn / chương hiện có ---------- */
let subjects = [];       // [{id, name, icon}]
const chapterNums = {};  // id → Set(số chương đã có)

async function loadSubjects() {
  const f = await gh(repoPath(`/contents/data/mon.js?ref=${BRANCH}`));
  const text = b64ToUtf8(f.content);
  subjects = [];
  const re = /addSubject\(\{\s*id:\s*"([^"]+)",\s*name:\s*"((?:[^"\\]|\\.)*)"(?:,\s*icon:\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(text))) subjects.push({ id: m[1], name: JSON.parse(`"${m[2]}"`), icon: m[3] || "📘" });
  const dir = await gh(repoPath(`/contents/data?ref=${BRANCH}`));
  const dirs = new Set(dir.filter(x => x.type === "dir").map(x => x.name));
  await Promise.all(subjects.map(async s => {
    chapterNums[s.id] = new Set();
    if (!dirs.has(s.id)) return;
    const list = await gh(repoPath(`/contents/data/${encodeURIComponent(s.id)}?ref=${BRANCH}`));
    list.forEach(x => { const k = x.name.match(/^chuong(\d+)\.js$/); if (k) chapterNums[s.id].add(+k[1]); });
  }));
}

/* ---------- Trạng thái form ---------- */
const form = { subject: null, isNew: false, newName: "", newIcon: "📘", files: [] }; // files: [{file, num, title}]

function guessChapter(filename) {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  let m = stem.match(/(?:^|\s|-)(?:chương|chuong|chapter|chap|ch|bài|bai|c)\s*[.\-]?\s*(\d{1,2})(?!\d)(.*)$/i);
  if (!m) m = stem.match(/^(\d{1,2})(?!\d)(.*)$/);
  if (m) return { num: +m[1], title: m[2].replace(/^[\s.:\-–—+&,]+/, "").trim() };
  return { num: null, title: stem };
}
function usedNums() {
  const base = form.isNew || !form.subject ? new Set() : new Set(chapterNums[form.subject.id] || []);
  return base;
}
function nextFree(taken) {
  for (let i = 1; i <= 40; i++) if (!taken.has(i)) return i;
  return 40;
}

function addFiles(list) {
  const bad = [];
  for (const file of list) {
    const ext = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    if (!EXTS.includes(ext)) { bad.push(file.name); continue; }
    if (file.size > 40 * 1024 * 1024) { bad.push(`${file.name} (quá 40 MB)`); continue; }
    const g = guessChapter(file.name);
    const taken = new Set([...usedNums(), ...form.files.map(f => f.num)]);
    form.files.push({ file, num: g.num || nextFree(taken), title: g.title, guessed: !g.num });
  }
  render();
  if (bad.length) showMsg(`Bỏ qua: ${bad.join(", ")}. Chỉ nhận PDF, Word .docx, .txt (file .doc cũ: mở bằng Word rồi Lưu thành .docx).`);
}
// Khi đổi môn: chương đoán ra từ tên file giữ nguyên, chương tự đánh số thì tính lại
function renumber() {
  const taken = new Set(usedNums());
  form.files.forEach(f => { if (!f.guessed) taken.add(f.num); });
  form.files.forEach(f => { if (f.guessed) { f.num = nextFree(taken); taken.add(f.num); } });
}

let msg = "";
function showMsg(t) { msg = t; const el = document.getElementById("msg"); if (el) { el.textContent = t; el.hidden = !t; } }

/* ---------- Màn hình: kết nối GitHub ---------- */
function renderConnect(err) {
  const url = "https://github.com/settings/personal-access-tokens/new?" + new URLSearchParams({
    name: `Web on tap ${REPO}`,
    description: `Dùng cho trang Thêm đề của web ôn tập (${OWNER}/${REPO}): tải file đề lên thư mục nhap/ và xem tiến trình.`,
    target_name: OWNER,
    expires_in: "366",
    contents: "write",
    actions: "read",
  }).toString();
  $app.innerHTML = `
    <section class="hero"><div class="hero-icon">🔑</div>
      <div class="hero-text"><h1>Kết nối GitHub</h1><p class="sub">Chỉ làm 1 lần trên mỗi máy / điện thoại.</p></div></section>
    <div class="card stack">
      <ol class="howto">
        <li>Bấm nút dưới để mở trang tạo mã (đã điền sẵn quyền).</li>
        <li>Ở mục <b>Repository access</b> chọn <b>Only select repositories</b> → chọn <b>${esc(REPO)}</b>.</li>
        <li>Kéo xuống cuối bấm <b>Generate token</b>, rồi bấm nút copy mã (bắt đầu bằng <code>github_pat_</code>).</li>
        <li>Quay lại đây, dán mã vào ô bên dưới, bấm <b>Lưu</b>.</li>
      </ol>
      <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">🔗 Mở trang tạo mã trên GitHub</a>
      <div>
        <label class="label" for="tok">Mã GitHub</label>
        <div class="row">
          <input id="tok" class="input grow" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false">
          <button class="btn primary" id="saveTok" type="button">Lưu</button>
        </div>
      </div>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      <p class="hint">Mã chỉ lưu trên trình duyệt này, chỉ có quyền ghi vào repo <b>${esc(REPO)}</b>. Muốn gỡ: xóa mã trong trang Settings → Developer settings của GitHub.</p>
    </div>`;
  const inp = document.getElementById("tok");
  const save = async () => {
    const v = inp.value.trim();
    if (!v) return;
    token = v;
    document.getElementById("saveTok").disabled = true;
    try {
      const r = await gh(repoPath(""));
      if (!r.permissions || !r.permissions.push) throw new Error("Mã này chưa có quyền ghi vào repo. Kiểm tra lại bước 2–3.");
      try { localStorage.setItem(TOKEN_KEY, v); } catch { }
      start();
    } catch (e) {
      token = null;
      renderConnect(e.status === 401 ? "Mã không đúng hoặc đã hết hạn." :
        e.status === 404 ? `Mã chưa được cấp quyền vào repo ${REPO} (bước 2).` : e.message);
    }
  };
  document.getElementById("saveTok").onclick = save;
  inp.onkeydown = e => { if (e.key === "Enter") save(); };
}

/* ---------- Màn hình: chọn môn + file ---------- */
function render() {
  const sel = form.subject;
  const taken = usedNums();
  const dupes = new Set(form.files.map(f => f.num).filter((n, i, a) => a.indexOf(n) !== i));
  const canGo = (form.isNew ? form.newName.trim() : sel) && form.files.length &&
    form.files.every(f => f.num >= 1 && f.num <= 40) && !dupes.size;

  $app.innerHTML = `
    <h2 style="margin-top:0">1. Chọn môn</h2>
    <div class="subjects">
      ${subjects.map(s => `
        <button class="subject ${!form.isNew && sel && sel.id === s.id ? "on" : ""}" data-sub="${esc(s.id)}" type="button">
          <span class="sicon">${esc(s.icon)}</span>
          <span class="stext"><b>${esc(s.name)}</b><small>${(chapterNums[s.id] || new Set()).size} chương</small></span>
        </button>`).join("")}
      <button class="subject new ${form.isNew ? "on" : ""}" data-new="1" type="button">
        <span class="sicon">＋</span><span class="stext"><b>Môn mới</b><small>Tạo môn chưa có</small></span>
      </button>
    </div>
    ${form.isNew ? `
      <div class="card stack" style="margin-bottom:20px">
        <div>
          <label class="label" for="newName">Tên môn</label>
          <input id="newName" class="input" placeholder="Ví dụ: Kinh tế vi mô" value="${esc(form.newName)}" maxlength="60">
        </div>
        <div>
          <span class="label">Biểu tượng</span>
          <div class="emojis">${EMOJIS.map(e => `<button type="button" data-emo="${e}" class="${e === form.newIcon ? "on" : ""}">${e}</button>`).join("")}</div>
        </div>
      </div>` : ""}

    <h2>2. Chọn tài liệu</h2>
    <label class="drop" id="drop">
      <input id="pick" type="file" multiple accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain">
      <div style="font-size:1.8rem">📄</div>
      <div><b>Bấm để chọn file</b> hoặc kéo thả vào đây</div>
      <div class="hint" style="margin-top:4px">PDF, Word (.docx), .txt — chọn được nhiều file, mỗi file là 1 chương</div>
    </label>
    ${form.files.length ? `<div class="files" style="margin-top:12px">
      ${form.files.map((f, i) => `
        <div class="file">
          <span class="fname">📎 ${esc(f.file.name)}</span>
          <input class="input num" type="number" min="1" max="40" value="${f.num}" data-num="${i}" title="Số chương" aria-label="Số chương">
          <input class="input" value="${esc(f.title)}" data-title="${i}" placeholder="Tên chương (không bắt buộc)" aria-label="Tên chương">
          <button class="x" type="button" data-rm="${i}" title="Bỏ file này">✕</button>
          ${dupes.has(f.num) ? `<span class="warn">Trùng số chương với file khác</span>` :
            taken.has(f.num) ? `<span class="warn">Chương ${f.num} đã có — sẽ được thay bằng file này</span>` : ""}
        </div>`).join("")}
    </div>` : ""}

    <div id="msg" class="err" style="margin-top:12px" ${msg ? "" : "hidden"}>${esc(msg)}</div>

    <div class="actions" style="margin-top:22px">
      <button class="btn primary big grow" id="go" type="button" ${canGo ? "" : "disabled"}>⬆️ Tải lên & cập nhật web</button>
    </div>
    <p class="hint">Đáp án đúng cần được đánh dấu trong file: dòng <code>Đáp án: B</code>, bảng đáp án cuối file, dấu <code>*</code>, hoặc in đậm / tô màu đáp án đúng.
      <a href="https://github.com/${esc(OWNER)}/${esc(REPO)}/blob/${BRANCH}/nhap/HUONG_DAN.md" target="_blank" rel="noopener">Xem mẫu đề</a></p>
    <p class="hint"><button class="link-btn muted" id="logout" type="button">Gỡ mã GitHub khỏi trình duyệt này</button></p>`;

  $app.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => {
    form.subject = subjects.find(s => s.id === b.dataset.sub); form.isNew = false; renumber(); render();
  });
  $app.querySelector("[data-new]").onclick = () => { form.isNew = true; form.subject = null; renumber(); render(); document.getElementById("newName")?.focus(); };
  const nn = document.getElementById("newName");
  if (nn) nn.oninput = () => { form.newName = nn.value; document.getElementById("go").disabled = !(nn.value.trim() && form.files.length); };
  $app.querySelectorAll("[data-emo]").forEach(b => b.onclick = () => { form.newIcon = b.dataset.emo; render(); });
  document.getElementById("pick").onchange = e => { addFiles([...e.target.files]); };
  const drop = document.getElementById("drop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); };
  $app.querySelectorAll("[data-num]").forEach(inp => inp.onchange = () => {
    const f = form.files[+inp.dataset.num]; f.num = Math.max(1, Math.min(40, parseInt(inp.value, 10) || 1)); f.guessed = false; render();
  });
  $app.querySelectorAll("[data-title]").forEach(inp => inp.oninput = () => { form.files[+inp.dataset.title].title = inp.value; });
  $app.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { form.files.splice(+b.dataset.rm, 1); render(); });
  document.getElementById("go").onclick = upload;
  document.getElementById("logout").onclick = () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { }
    token = null; renderConnect();
  };
}

/* ---------- Tải lên + theo dõi ---------- */
const STEPS = ["Tải file lên GitHub", "Chuyển đề thành câu hỏi", "Đưa web lên lại"];
function renderProgress(state, extra = "") {
  // state: mảng trạng thái cho từng bước: "" | "run" | "done" | "fail"
  $app.innerHTML = `
    <section class="hero"><div class="hero-icon">${form.isNew ? esc(form.newIcon) : esc(form.subject.icon)}</div>
      <div class="hero-text"><h1>${esc(form.isNew ? form.newName.trim() : form.subject.name)}</h1>
      <p class="sub">${form.files.length} file · chương ${form.files.map(f => f.num).sort((a, b) => a - b).join(", ")}</p></div></section>
    <div class="card"><ul class="steps">
      ${STEPS.map((s, i) => `<li class="${state[i] || ""}"><span class="dot">${state[i] === "done" ? "✓" : state[i] === "fail" ? "✕" : i + 1}</span>${s}</li>`).join("")}
    </ul></div>
    ${extra}`;
}

function cleanName(s) { return s.replace(/[\\/:*?"<>|#%]/g, " ").replace(/\s+/g, " ").trim(); }

async function upload() {
  const subjName = form.isNew ? cleanName(form.newName) : form.subject.name;
  const folder = form.isNew ? `${subjName} ${form.newIcon}` : subjName;
  const st = ["run", "", ""];
  renderProgress(st);
  let commitSha;
  try {
    const blobs = await Promise.all(form.files.map(async f => {
      const ext = (f.file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
      const title = cleanName(f.title || "");
      const name = `Chương ${f.num}${title ? ` - ${title}` : ""}${ext}`;
      const blob = await gh(repoPath("/git/blobs"), {
        method: "POST", body: JSON.stringify({ content: await fileToB64(f.file), encoding: "base64" }),
      });
      return { path: `nhap/${cleanName(folder)}/${name}`, mode: "100644", type: "blob", sha: blob.sha };
    }));
    const msgText = `Thêm đề: ${subjName} – chương ${form.files.map(f => f.num).join(", ")}`;
    for (let attempt = 0; ; attempt++) {
      const ref = await gh(repoPath(`/git/ref/heads/${BRANCH}`));
      const parent = await gh(repoPath(`/git/commits/${ref.object.sha}`));
      const tree = await gh(repoPath("/git/trees"), { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree: blobs }) });
      const commit = await gh(repoPath("/git/commits"), {
        method: "POST", body: JSON.stringify({ message: msgText, tree: tree.sha, parents: [ref.object.sha] }),
      });
      try {
        await gh(repoPath(`/git/refs/heads/${BRANCH}`), { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
        commitSha = commit.sha;
        break;
      } catch (e) {
        if (attempt < 2 && e.status === 422) { await sleep(1500); continue; } // repo vừa có commit khác, thử lại
        throw e;
      }
    }
  } catch (e) {
    st[0] = "fail";
    if (e.status === 401) { try { localStorage.removeItem(TOKEN_KEY); } catch { } }
    return renderProgress(st, `<div class="err" style="margin-top:14px">${esc(e.status === 401 ? "Mã GitHub hết hạn hoặc đã bị xóa — tải lại trang để kết nối lại." : e.message)}</div>
      <div class="actions"><button class="btn" onclick="location.reload()">Thử lại</button></div>`);
  }

  st[0] = "done"; st[1] = "run";
  renderProgress(st, `<p class="hint">Thường mất khoảng 1 phút, cứ để trang này mở.</p>`);
  const runsUrl = `https://github.com/${OWNER}/${REPO}/actions`;
  const t0 = Date.now();
  let run = null, conclusion = null;
  while (Date.now() - t0 < 8 * 60 * 1000) {
    await sleep(4000);
    try {
      if (!run) {
        const r = await gh(repoPath(`/actions/runs?head_sha=${commitSha}&per_page=5`));
        run = (r.workflow_runs || []).find(x => x.path && x.path.includes("cap-nhat-web")) || null;
        if (!run) continue;
      }
      const jobs = await gh(repoPath(`/actions/runs/${run.id}/jobs`));
      const steps = (jobs.jobs[0] && jobs.jobs[0].steps) || [];
      const conv = steps.find(s => s.name === "Chuyển đề thành câu hỏi");
      const dep = steps.find(s => /deploy-pages/.test(s.name));
      if (conv && conv.status === "completed") st[1] = conv.conclusion === "success" ? "done" : "fail";
      if (st[1] === "done") st[2] = dep && dep.status === "completed" ? (dep.conclusion === "success" ? "done" : "fail") : "run";
      renderProgress(st, `<p class="hint">Thường mất khoảng 1 phút, cứ để trang này mở.</p>`);
      const rr = await gh(repoPath(`/actions/runs/${run.id}`));
      if (rr.status === "completed") { conclusion = rr.conclusion; break; }
    } catch (e) {
      if (e.status === 403 || e.status === 404) break; // mã không có quyền xem Actions → bỏ qua phần theo dõi
    }
  }

  let report = "";
  try {
    const f = await gh(repoPath(`/contents/nhap/KET_QUA.md?ref=${BRANCH}`));
    report = b64ToUtf8(f.content);
  } catch { }
  if (conclusion === "success" || (report && !/❌/.test(report))) {
    st[0] = st[1] = st[2] = "done";
    try { localStorage.setItem(BUST_KEY, String(Date.now())); } catch { }
  } else if (conclusion) {
    st[1] = st[1] === "done" ? "done" : "fail";
    if (st[2] !== "done") st[2] = report && /✅/.test(report) ? "done" : "fail";
    if (st[2] === "done") { try { localStorage.setItem(BUST_KEY, String(Date.now())); } catch { } }
  }
  const okAll = st.every(x => x === "done") && !/❌/.test(report);
  renderProgress(st, `
    <div class="card report" style="margin-top:14px">
      ${okAll ? `<div class="okbox">🎉 Xong! Đề đã lên web.</div>` :
        conclusion === null ? `<div class="err">Chưa thấy kết quả. Xem tiến trình ở <a href="${runsUrl}" target="_blank" rel="noopener">tab Actions</a>.</div>` :
        `<div class="err">Có file chưa chuyển được — xem chi tiết bên dưới, sửa file rồi tải lại.</div>`}
      ${report ? mdToHtml(report) : ""}
    </div>
    <div class="actions">
      <a class="btn primary grow" href="./?v=${Date.now()}">📚 Về trang ôn tập</a>
      <button class="btn grow" type="button" id="again">➕ Thêm đề khác</button>
    </div>`);
  document.getElementById("again").onclick = () => { form.files = []; msg = ""; start(); };
}

/* Markdown rất gọn cho file KET_QUA.md */
function mdToHtml(md) {
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, "$1<i>$2</i>");
  let html = "", inList = false;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^# /.test(line)) continue;
    const li = line.match(/^(\s*)- (.*)$/);
    if (li) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li${li[1].length ? ' style="margin-left:14px"' : ""}>${inline(li[2])}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (/^## /.test(line)) html += `<h3>${inline(line.slice(3))}</h3>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (inList ? "</ul>" : "");
}

/* ---------- Khởi động ---------- */
async function start() {
  if (!token) return renderConnect();
  $app.innerHTML = `<div class="loading"><span class="spinner"></span>Đang lấy danh sách môn…</div>`;
  try {
    await loadSubjects();
  } catch (e) {
    if (e.status === 401) { try { localStorage.removeItem(TOKEN_KEY); } catch { } token = null; return renderConnect("Mã GitHub hết hạn hoặc đã bị xóa — tạo mã mới."); }
    $app.innerHTML = `<div class="card"><div class="err">${esc(e.message)}</div>
      <div class="actions"><button class="btn" onclick="location.reload()">Thử lại</button></div></div>`;
    return;
  }
  if (form.subject) form.subject = subjects.find(s => s.id === form.subject.id) || null;
  if (!form.subject && !form.isNew) {
    const st = loadStore();
    const cur = st.settings && st.settings.subject;
    form.subject = subjects.find(s => s.id === cur) || subjects[0] || null;
    if (!form.subject) form.isNew = true;
  }
  render();
}
start();
