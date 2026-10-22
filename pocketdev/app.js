/* ================= PocketDev 核心逻辑 ================= */

// ---------- 项目文件系统 ----------
const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>我的项目</title>
</head>
<body>
  <h1>Hello PocketDev</h1>
  <p>在左侧对话框描述需求，AI 会帮你生成代码。</p>
</body>
</html>`;

const STORAGE_KEY = "pocketdev_files";
const STATS_KEY = "pocketdev_stats";

let files = { "index.html": DEFAULT_HTML };
let activeFile = "index.html";
let undoStack = [], redoStack = [];
let tokens = 0, builds = 4, saved = 0, memories = 0, workTreeOn = false;
let autoSaveTimer = null;

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const editor = $("codeEditor"), lineNums = $("lineNums");
const previewFrame = $("previewFrame");

// ---------- Toast ----------
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- 持久化 ----------
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch (e) {
    console.warn("localStorage save failed:", e);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        files = parsed;
        if (!files["index.html"]) files["index.html"] = DEFAULT_HTML;
      }
    }
    const stats = localStorage.getItem(STATS_KEY);
    if (stats) {
      const s = JSON.parse(stats);
      tokens = s.tokens || 0;
      builds = s.builds || 4;
      saved = s.saved || 0;
      memories = s.memories || 0;
    }
  } catch (e) {
    console.warn("localStorage load failed:", e);
  }
}

function saveStats() {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify({ tokens, builds, saved, memories }));
  } catch (e) { /* ignore */ }
}

// ---------- 文件标签 ----------
function renderTabs() {
  const box = $("fileTabs");
  box.innerHTML = "";
  Object.keys(files).forEach(name => {
    const tab = document.createElement("div");
    tab.className = "file-tab" + (name === activeFile ? " active" : "");
    tab.innerHTML = `<span>${name}</span>` + (name !== "index.html" ? `<span class="close" data-f="${name}">✕</span>` : "");
    tab.onclick = e => {
      if (e.target.dataset.f) { closeFile(e.target.dataset.f); return; }
      switchFile(name);
    };
    box.appendChild(tab);
  });
  const add = document.createElement("button");
  add.className = "file-tab add";
  add.textContent = "+";
  add.onclick = addFile;
  box.appendChild(add);
}

function switchFile(name) {
  files[activeFile] = editor.value;
  activeFile = name;
  editor.value = files[name];
  $("currentFileName").textContent = name;
  undoStack = [];
  redoStack = [];
  updateLineNums();
  renderTabs();
  saveToStorage();
}

function addFile() {
  const name = prompt("新建文件名（如 page.html / style.css / app.js）");
  if (!name || !name.trim()) return;
  const clean = name.trim();
  if (files[clean]) { toast("文件已存在"); return; }
  if (!/\.(html|css|js|json|txt|md)$/i.test(clean)) {
    toast("请使用 .html / .css / .js / .json / .txt / .md 扩展名");
    return;
  }
  files[clean] = clean.endsWith(".css") ? "/* 样式 */" : clean.endsWith(".js") ? "// 脚本" : clean.endsWith(".json") ? "{}" : clean.endsWith(".md") ? "# 文档" : clean.endsWith(".txt") ? "" : DEFAULT_HTML;
  switchFile(clean);
  toast("已创建 " + clean);
}

function closeFile(name) {
  if (name === "index.html") { toast("index.html 不可删除"); return; }
  if (!confirm(`确定删除 ${name} 吗？`)) return;
  delete files[name];
  if (activeFile === name) switchFile("index.html");
  renderTabs();
  saveToStorage();
  toast("已删除 " + name);
}

// ---------- 编辑器 ----------
function updateLineNums() {
  const n = editor.value.split("\n").length;
  lineNums.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
}

editor.addEventListener("input", () => {
  files[activeFile] = editor.value;
  updateLineNums();
  setDirty(true);
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { saveToStorage(); setDirty(false); }, 1500);
});
editor.addEventListener("scroll", () => { lineNums.scrollTop = editor.scrollTop; });

function setDirty(dirty) {
  const s = $("saveState");
  s.textContent = dirty ? "● 未保存" : "✓ 已保存";
  s.classList.toggle("dirty", dirty);
}

function save() {
  files[activeFile] = editor.value;
  setDirty(false);
  saveToStorage();
  refreshPreview();
  toast("已保存并刷新预览");
}
$("btnSave").onclick = save;

// 撤销 / 重做
function pushUndo() {
  undoStack.push(editor.value);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}

$("btnUndo").onclick = () => {
  if (undoStack.length === 0) { toast("没有可撤销的修改"); return; }
  redoStack.push(editor.value);
  const prev = undoStack.pop();
  editor.value = prev;
  files[activeFile] = prev;
  updateLineNums();
  setDirty(true);
};

$("btnRedo").onclick = () => {
  if (redoStack.length === 0) { toast("没有可重做的修改"); return; }
  undoStack.push(editor.value);
  const next = redoStack.pop();
  editor.value = next;
  files[activeFile] = next;
  updateLineNums();
  setDirty(true);
};

// ---------- 预览 ----------
function refreshPreview() {
  let html = files["index.html"] || "";
  const css = Object.keys(files).filter(f => f.endsWith(".css")).map(f => files[f]).join("\n");
  const js = Object.keys(files).filter(f => f.endsWith(".js")).map(f => files[f]).join("\n");
  if (css) html = html.replace("</head>", `<style>\n${css}\n</style></head>`);
  if (js) html = html.replace("</body>", `<script>\n${js}\n<\/script></body>`);
  previewFrame.srcdoc = html;
}
$("btnRefresh").onclick = () => { refreshPreview(); toast("预览已刷新"); };

// 代码 / 预览切换
$("tabCode").onclick = () => setView("code");
$("tabPreview").onclick = () => setView("preview");
function setView(v) {
  $("tabCode").classList.toggle("active", v === "code");
  $("tabPreview").classList.toggle("active", v === "preview");
  $("tabCode").textContent = (v === "code" ? "✓ " : "") + "代码";
  $("tabPreview").textContent = (v === "preview" ? "✓ " : "") + "预览";
  $("codeWrap").classList.toggle("hidden", v !== "code");
  $("previewWrap").classList.toggle("hidden", v !== "preview");
  if (v === "preview") refreshPreview();
}

// 设备尺寸
document.querySelectorAll(".device").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".device").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    previewFrame.className = "preview-" + btn.dataset.device;
    setView("preview");
  };
});

// ---------- 移动端面板切换 ----------
function isMobile() { return window.innerWidth <= 900; }

document.querySelectorAll(".mnav-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".mnav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("mobile-active"));
    $("panel-" + btn.dataset.panel).classList.add("mobile-active");
  };
});

// 初始化移动端面板
if (isMobile()) {
  $("panel-chat").classList.add("mobile-active");
} else {
  // 桌面端全部可见
  $("panel-chat").classList.add("mobile-active");
  $("panel-editor").classList.add("mobile-active");
  $("panel-assistant").classList.add("mobile-active");
}

// ---------- 对话开发（左栏） ----------
function addMsg(container, text, who) {
  const div = document.createElement("div");
  div.className = "msg " + who;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function sendChat(text) {
  if (!text.trim()) return;
  $("welcome")?.remove();
  addMsg($("chatBody"), text, "user");
  $("chatInput").value = "";
  tokens += Math.ceil(text.length / 2);
  $("tokenCount").textContent = tokens;

  const thinking = addMsg($("chatBody"), "正在生成…", "ai typing");
  setTimeout(() => {
    thinking.remove();
    const reply = generateFromPrompt(text);
    addMsg($("chatBody"), reply.userMsg, "ai");
    addMsg($("aiMessages"), reply.assistMsg, "ai");
    tokens += 120;
    $("tokenCount").textContent = tokens;
    memories += 1;
    $("memCount").textContent = memories;
    $("indexCount").textContent = Object.keys(files).length;
    saveStats();
    // 自动切到代码面板（移动端）
    if (isMobile()) {
      document.querySelector('.mnav-btn[data-panel="editor"]').click();
    }
  }, 700);
}

$("chatSend").onclick = () => sendChat($("chatInput").value);
$("chatInput").addEventListener("keydown", e => { if (e.key === "Enter") sendChat($("chatInput").value); });
document.querySelectorAll(".try-item").forEach(b => b.onclick = () => sendChat(b.dataset.prompt));

// AI 助手追问
$("aiSend").onclick = () => {
  const t = $("aiInput").value;
  if (!t.trim()) return;
  addMsg($("aiMessages"), t, "user");
  $("aiInput").value = "";
  setTimeout(() => addMsg($("aiMessages"), "已收到。端侧引擎正在分析这段报错，修复建议会同步应用到代码。", "ai"), 600);
};
$("aiInput").addEventListener("keydown", e => { if (e.key === "Enter") $("aiSend").click(); });

// ---------- 端侧 AI 代码生成 ----------
function generateFromPrompt(text) {
  pushUndo();

  const lower = text.toLowerCase();

  if (/番茄钟|pomodoro|计时|专注|倒计时/.test(lower)) {
    files["index.html"] = POMODORO_HTML;
    saveToStorage();
    return {
      userMsg: "已为你生成「番茄钟」🍅\n包含 25 分钟专注倒计时、开始/暂停/重置，已自动刷新预览。",
      assistMsg: "生成说明：\n1. 单文件实现，无外部依赖，离线可用\n2. setInterval 驱动倒计时\n3. 切换到「预览」即可使用"
    };
  }
  if (/商城|购物|登录|电商|shop|mall|商品/.test(lower)) {
    files["index.html"] = MALL_HTML;
    saveToStorage();
    return {
      userMsg: "已为你生成「商城」🛍️\n包含登录页 + 首页商品列表 + 底部导航，点击预览体验完整流程。",
      assistMsg: "生成说明：\n1. 登录页：手机号 + 验证码 UI\n2. 首页：商品卡片网格 + 搜索栏\n3. 纯本地模拟登录态，可离线运行"
    };
  }
  if (/待办|todo|清单|任务|事项/.test(lower)) {
    files["index.html"] = TODO_HTML;
    saveToStorage();
    return {
      userMsg: "已为你生成「待办清单」✅\n支持添加、完成、删除任务，数据保存在 localStorage。",
      assistMsg: "生成说明：\n1. 单文件实现，localStorage 持久化\n2. 支持任务状态切换和删除\n3. 响应式布局，移动端友好"
    };
  }
  if (/贪吃蛇|snake|游戏/.test(lower)) {
    files["index.html"] = SNAKE_HTML;
    saveToStorage();
    return {
      userMsg: "已为你生成「贪吃蛇」🐍\n经典游戏，支持触屏滑动和方向键控制。",
      assistMsg: "生成说明：\n1. Canvas 渲染，60fps 流畅体验\n2. 触屏滑动 + 键盘方向键双控制\n3. 计分系统和游戏结束重开"
    };
  }
  // 默认：生成一个落地页
  files["index.html"] = landingHTML(text);
  saveToStorage();
  return {
    userMsg: `已根据「${text.slice(0, 20)}」生成一个单页应用骨架，可在代码区继续修改。`,
    assistMsg: "生成说明：\n1. 已写入 index.html 并刷新预览\n2. 说「加一个 XX 页面」可继续迭代\n3. 点黄色 ✓ 保存到工作树"
  };
}

function landingHTML(title) {
  const safeTitle = title.slice(0, 20).replace(/</g, "<").replace(/>/g, ">");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle.slice(0, 12)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; background: #f7f8fa; }
  .hero { padding: 60px 24px; text-align: center; background: linear-gradient(135deg, #2f6bff, #6a3df0); color: #fff; }
  .hero h1 { font-size: 26px; }
  .hero p { opacity: .85; margin-top: 10px; }
  .btn { display: inline-block; margin-top: 22px; background: #fff; color: #2f6bff; padding: 12px 32px; border-radius: 24px; font-weight: 600; }
  .cards { padding: 20px; display: grid; gap: 14px; }
  .card { background: #fff; border-radius: 14px; padding: 18px; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
</style>
</head>
<body>
  <div class="hero">
    <h1>${safeTitle}</h1>
    <p>由 PocketDev 端侧 AI 生成</p>
    <span class="btn">立即开始</span>
  </div>
  <div class="cards">
    <div class="card">📱 移动端优先，自适应布局</div>
    <div class="card">⚡ 单文件交付，可直接打包 APK</div>
    <div class="card">🔧 继续对话即可迭代此页面</div>
  </div>
</body>
</html>`;
}

// ---------- 内置模板 ----------
const POMODORO_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>番茄钟</title>
<style>
  body { font-family: -apple-system,"PingFang SC",sans-serif; background:#fdf3f0; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  h1 { color:#e2543a; font-size:22px; }
  .timer { font-size:72px; font-weight:700; font-variant-numeric:tabular-nums; color:#333; margin:24px 0; }
  .ring { width:220px; height:220px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 30px rgba(226,84,58,.15); flex-direction:column; }
  .btns { display:flex; gap:12px; margin-top:30px; }
  button { border:none; padding:12px 28px; border-radius:24px; font-size:15px; cursor:pointer; }
  .start { background:#e2543a; color:#fff; }
  .ghost { background:#fff; color:#666; }
  #state { color:#999; font-size:13px; margin-top:14px; }
</style>
</head>
<body>
  <h1>🍅 番茄钟</h1>
  <div class="ring"><div class="timer" id="t">25:00</div></div>
  <div id="state">准备专注</div>
  <div class="btns">
    <button class="start" id="go">开始</button>
    <button class="ghost" id="reset">重置</button>
  </div>
<script>
let left = 25*60, run = false, iv = null;
const t = document.getElementById('t'), go = document.getElementById('go'), st = document.getElementById('state');
function show(){ t.textContent = String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0'); }
go.onclick = () => {
  run = !run;
  go.textContent = run ? '暂停' : '开始';
  st.textContent = run ? '专注中…' : '已暂停';
  clearInterval(iv);
  if (run) iv = setInterval(() => {
    left--; show();
    if (left <= 0) { clearInterval(iv); run = false; go.textContent='开始'; st.textContent='🎉 完成一个番茄钟！'; left = 25*60; show(); }
  }, 1000);
};
document.getElementById('reset').onclick = () => { clearInterval(iv); run=false; left=25*60; show(); go.textContent='开始'; st.textContent='准备专注'; };
show();
<\/script>
</body>
</html>`;

const MALL_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>优选商城</title>
<style>
  * { margin:0; box-sizing:border-box; font-family:-apple-system,"PingFang SC",sans-serif; }
  body { background:#f6f7f9; }
  .page { min-height:100vh; }
  #login { display:flex; flex-direction:column; justify-content:center; padding:40px 28px; background:linear-gradient(160deg,#2f6bff,#7a5cff); min-height:100vh; }
  #login h1 { color:#fff; font-size:26px; margin-bottom:6px; }
  #login p { color:rgba(255,255,255,.8); font-size:14px; margin-bottom:34px; }
  #login input { width:100%; border:none; border-radius:12px; padding:15px 16px; margin-bottom:14px; font-size:15px; background:rgba(255,255,255,.95); }
  #loginBtn { width:100%; border:none; border-radius:12px; padding:15px; font-size:16px; font-weight:600; background:#ffd94d; color:#5a4a00; }
  #home { display:none; padding-bottom:70px; }
  .top { background:#fff; padding:14px 16px; position:sticky; top:0; }
  .search { background:#f0f1f4; border-radius:20px; padding:10px 16px; color:#999; font-size:14px; }
  .banner { margin:14px 16px; border-radius:16px; background:linear-gradient(120deg,#ff8a5c,#ff5c8a); color:#fff; padding:26px 20px; font-size:19px; font-weight:600; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:0 16px; }
  .item { background:#fff; border-radius:14px; overflow:hidden; }
  .item .img { height:110px; display:flex; align-items:center; justify-content:center; font-size:44px; background:#fafbfc; }
  .item .info { padding:10px 12px; }
  .item .name { font-size:14px; }
  .item .price { color:#f04438; font-weight:700; margin-top:6px; }
  .tabbar { position:fixed; bottom:0; left:0; right:0; background:#fff; display:flex; border-top:1px solid #eee; }
  .tabbar div { flex:1; text-align:center; padding:10px 0 14px; font-size:12px; color:#888; }
  .tabbar div.on { color:#2f6bff; }
</style>
</head>
<body>
  <div class="page" id="login">
    <h1>优选商城</h1>
    <p>登录后享受会员专属价</p>
    <input placeholder="手机号" maxlength="11">
    <input placeholder="验证码" maxlength="6">
    <button id="loginBtn">登录 / 注册</button>
  </div>
  <div class="page" id="home">
    <div class="top"><div class="search">🔍 搜索「蓝牙耳机」</div></div>
    <div class="banner">新人专享 · 全场 5 折起</div>
    <div class="grid">
      <div class="item"><div class="img">🎧</div><div class="info"><div class="name">无线蓝牙耳机</div><div class="price">¥129</div></div></div>
      <div class="item"><div class="img">⌚</div><div class="info"><div class="name">智能手表</div><div class="price">¥399</div></div></div>
      <div class="item"><div class="img">👟</div><div class="info"><div class="name">轻跑运动鞋</div><div class="price">¥219</div></div></div>
      <div class="item"><div class="img">🎒</div><div class="info"><div class="name">城市通勤背包</div><div class="price">¥159</div></div></div>
    </div>
    <div class="tabbar">
      <div class="on">🏠<br>首页</div><div>🗂️<br>分类</div><div>🛒<br>购物车</div><div>👤<br>我的</div>
    </div>
  </div>
<script>
document.getElementById('loginBtn').onclick = () => {
  document.getElementById('login').style.display = 'none';
  document.getElementById('home').style.display = 'block';
};
<\/script>
</body>
</html>`;

const TODO_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>待办清单</title>
<style>
  * { margin:0; box-sizing:border-box; font-family:-apple-system,"PingFang SC",sans-serif; }
  body { background:#f0f4f8; min-height:100vh; padding:20px; }
  .container { max-width:500px; margin:0 auto; }
  h1 { text-align:center; color:#2d3748; margin-bottom:24px; font-size:24px; }
  .input-row { display:flex; gap:10px; margin-bottom:20px; }
  #taskInput { flex:1; border:none; border-radius:12px; padding:14px 16px; font-size:15px; background:#fff; box-shadow:0 2px 8px rgba(0,0,0,.06); }
  #addBtn { border:none; border-radius:12px; padding:14px 20px; background:#2f6bff; color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  .task-list { display:flex; flex-direction:column; gap:10px; }
  .task-item { display:flex; align-items:center; gap:12px; background:#fff; border-radius:12px; padding:14px 16px; box-shadow:0 2px 8px rgba(0,0,0,.06); }
  .task-item.done .task-text { text-decoration:line-through; color:#a0aec0; }
  .task-check { width:22px; height:22px; border-radius:50%; border:2px solid #cbd5e0; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .task-item.done .task-check { background:#48bb78; border-color:#48bb78; color:#fff; }
  .task-text { flex:1; font-size:15px; color:#2d3748; }
  .task-del { border:none; background:none; color:#e53e3e; font-size:18px; cursor:pointer; padding:4px; }
  .empty { text-align:center; color:#a0aec0; padding:40px; font-size:14px; }
</style>
</head>
<body>
  <div class="container">
    <h1>✅ 待办清单</h1>
    <div class="input-row">
      <input id="taskInput" placeholder="添加新任务…">
      <button id="addBtn">添加</button>
    </div>
    <div class="task-list" id="taskList"></div>
  </div>
<script>
let tasks = JSON.parse(localStorage.getItem('pocketdev_todo') || '[]');
const list = document.getElementById('taskList');
const input = document.getElementById('taskInput');

function save() { localStorage.setItem('pocketdev_todo', JSON.stringify(tasks)); }
function render() {
  list.innerHTML = tasks.length === 0 ? '<div class="empty">暂无任务，添加一个吧</div>' : '';
  tasks.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'task-item' + (t.done ? ' done' : '');
    div.innerHTML = \`<div class="task-check">\${t.done ? '✓' : ''}</div><span class="task-text">\${t.text}</span><button class="task-del">✕</button>\`;
    div.querySelector('.task-check').onclick = () => { tasks[i].done = !tasks[i].done; save(); render(); };
    div.querySelector('.task-del').onclick = () => { tasks.splice(i, 1); save(); render(); };
    list.appendChild(div);
  });
}
document.getElementById('addBtn').onclick = () => {
  const text = input.value.trim();
  if (!text) return;
  tasks.push({ text, done: false });
  input.value = '';
  save(); render();
};
input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('addBtn').click(); });
render();
<\/script>
</body>
</html>`;

const SNAKE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>贪吃蛇</title>
<style>
  * { margin:0; box-sizing:border-box; }
  body { background:#0a0e1a; color:#e6e6e6; font-family:-apple-system,"PingFang SC",sans-serif; display:flex; flex-direction:column; align-items:center; min-height:100vh; overflow:hidden; }
  header { width:100%; max-width:560px; padding:14px 18px 8px; display:flex; align-items:center; justify-content:space-between; }
  .title { font-size:1.35rem; font-weight:700; background:linear-gradient(90deg,#4ade80,#22d3ee,#a78bfa); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
  .stats { display:flex; gap:8px; }
  .chip { font-size:.75rem; padding:5px 10px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); border-radius:14px; }
  .chip b { color:#4ade80; }
  .stage { flex:1; width:100%; max-width:560px; display:flex; align-items:center; justify-content:center; padding:12px; }
  canvas { background:#0f172a; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,.3); }
  .controls { width:100%; max-width:560px; padding:12px 18px 24px; display:flex; justify-content:center; gap:12px; }
  .ctrl-btn { width:60px; height:60px; border-radius:50%; border:none; background:rgba(255,255,255,.1); color:#fff; font-size:24px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .ctrl-btn:active { background:rgba(255,255,255,.2); }
  #overlay { position:fixed; inset:0; background:rgba(10,14,26,.85); display:none; flex-direction:column; align-items:center; justify-content:center; z-index:10; }
  #overlay.show { display:flex; }
  #overlay h2 { font-size:2rem; margin-bottom:12px; }
  #overlay p { color:#94a3b8; margin-bottom:24px; }
  #restartBtn { padding:14px 40px; border-radius:24px; border:none; background:#4ade80; color:#0a0e1a; font-size:16px; font-weight:700; cursor:pointer; }
</style>
</head>
<body>
  <header>
    <div class="title">贪吃蛇</div>
    <div class="stats"><div class="chip">得分 <b id="score">0</b></div><div class="chip">最高 <b id="best">0</b></div></div>
  </header>
  <div class="stage"><canvas id="game" width="320" height="320"></canvas></div>
  <div class="controls">
    <button class="ctrl-btn" id="up">↑</button>
    <button class="ctrl-btn" id="left">←</button>
    <button class="ctrl-btn" id="right">→</button>
    <button class="ctrl-btn" id="down">↓</button>
  </div>
  <div id="overlay">
    <h2>游戏结束</h2>
    <p>得分：<span id="finalScore">0</span></p>
    <button id="restartBtn">重新开始</button>
  </div>
<script>
const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
const GRID = 20, SIZE = canvas.width / GRID;
let snake = [{x:10,y:10}], food = {x:5,y:5}, dir = {x:0,y:0}, score = 0, best = 0, speed = 150, loop = null, alive = true;
const scoreEl = document.getElementById('score'), bestEl = document.getElementById('best');

function placeFood() { food = { x: Math.floor(Math.random()*GRID), y: Math.floor(Math.random()*GRID) }; if (snake.some(s=>s.x===food.x&&s.y===food.y)) placeFood(); }
function draw() {
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(food.x*SIZE+SIZE/2, food.y*SIZE+SIZE/2, SIZE/2-2, 0, Math.PI*2); ctx.fill();
  snake.forEach((s,i) => {
    ctx.fillStyle = i===0 ? '#4ade80' : '#22d3ee';
    ctx.fillRect(s.x*SIZE+1, s.y*SIZE+1, SIZE-2, SIZE-2);
  });
}
function step() {
  if (!alive) return;
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  if (head.x<0||head.x>=GRID||head.y<0||head.y>=GRID||snake.some(s=>s.x===head.x&&s.y===head.y)) { gameOver(); return; }
  snake.unshift(head);
  if (head.x===food.x && head.y===food.y) { score+=10; scoreEl.textContent=score; if(score>best){best=score;bestEl.textContent=best;} placeFood(); if(speed>60)speed-=5; clearInterval(loop); loop=setInterval(step,speed); }
  else snake.pop();
  draw();
}
function gameOver() {
  alive = false; clearInterval(loop);
  document.getElementById('finalScore').textContent = score;
  document.getElementById('overlay').classList.add('show');
}
function restart() {
  snake=[{x:10,y:10}]; dir={x:0,y:0}; score=0; speed=150; alive=true;
  scoreEl.textContent=0; placeFood(); draw();
  document.getElementById('overlay').classList.remove('show');
  clearInterval(loop); loop=setInterval(step,speed);
}
document.getElementById('restartBtn').onclick = restart;

// 键盘
const dirs = { ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1}, ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0} };
document.addEventListener('keydown', e => { if(dirs[e.key] && (dir.x!==-dirs[e.key].x || dir.y!==-dirs[e.key].y)) dir = dirs[e.key]; });
// 触屏
let touchStart = null;
document.addEventListener('touchstart', e => touchStart = e.touches[0]);
document.addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.clientX, dy = e.changedTouches[0].clientY - touchStart.clientY;
  if (Math.abs(dx) > Math.abs(dy)) dir = dx>0 ? {x:1,y:0} : {x:-1,y:0};
  else dir = dy>0 ? {x:0,y:1} : {x:0,y:-1};
  touchStart = null;
});
// 按钮
['up','down','left','right'].forEach(id => {
  const map = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
  document.getElementById(id).onclick = () => { if(dir.x!==-map[id].x||dir.y!==-map[id].y) dir=map[id]; };
});
placeFood(); draw(); loop=setInterval(step,speed);
<\/script>
</body>
</html>`;

// ---------- 右栏：开关 / 打包 / 导出 ----------
$("workTreeSwitch").onchange = e => {
  workTreeOn = e.target.checked;
  toast(workTreeOn ? "永久工作树已开启：项目将写入手机存储" : "永久工作树已关闭");
};

$("memBtn").onclick = () => {
  toast(`长期记忆 ${memories} 条 · 已索引文件 ${Object.keys(files).length} 个`);
};

$("buildCard").onclick = e => {
  if (e.target.closest("button")) return;
  const state = $("buildState");
  if (state.textContent === "打包中") return;
  state.textContent = "打包中";
  $("buildProgress").classList.remove("hidden");
  $("downloadApkBtn").classList.add("hidden");
  let p = 0;
  const iv = setInterval(() => {
    p += Math.random() * 18;
    if (p >= 100) {
      p = 100;
      clearInterval(iv);
      state.textContent = "已完成";
      $("buildDesc").textContent = "app-release.apk（约 4.2 MB）已生成到 下载/PocketDev/";
      builds++; saved += 30;
      $("buildCount").textContent = builds;
      $("savedCount").textContent = saved;
      saveStats();
      toast("🎉 APK 打包完成");
      $("downloadApkBtn").classList.remove("hidden");
    }
    $("buildInner").style.width = p + "%";
  }, 350);
};

$("downloadApkBtn").onclick = () => {
  // 模拟下载：实际场景应生成真实 APK 文件
  const blob = new Blob(["PocketDev APK Placeholder - 实际打包需要后端构建服务"], { type: "application/vnd.android.package-archive" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "app-release.apk";
  a.click();
  URL.revokeObjectURL(url);
  toast("APK 下载已开始（模拟）");
};

$("exportBtn").onclick = () => {
  // 简单 ZIP 导出：使用 JSON 格式打包（无外部依赖）
  const data = JSON.stringify(files, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pocketdev-project.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("项目已导出为 JSON（可用文本编辑器查看）");
};

// ---------- 其他按钮 ----------
$("btnBack").onclick = () => toast("返回功能：实际场景会关闭当前项目");
$("btnChatMore").onclick = () => toast("更多选项：清空对话 / 导出记录 / 设置");
$("btnEditorMore").onclick = () => toast("更多选项：格式化代码 / 查找替换 / 文件设置");
$("btnAssistantMenu").onclick = () => toast("菜单：AI 模型切换 / 历史记录 / 帮助");
$("btnAssistantMore").onclick = () => toast("更多选项：导出记忆 / 清空索引 / 关于");
$("btnTextSettings").onclick = () => toast("文本设置：字体大小 / 主题 / 自动换行");
$("btnImage").onclick = () => toast("图片上传：实际场景支持粘贴/拖拽图片");
$("btnSearch").onclick = () => toast("搜索：在对话历史中查找内容");

// ---------- 初始化 ----------
loadFromStorage();
editor.value = files[activeFile] || DEFAULT_HTML;
updateLineNums();
renderTabs();
refreshPreview();
$("tokenCount").textContent = tokens;
$("buildCount").textContent = builds;
$("savedCount").textContent = saved;
$("memCount").textContent = memories;
$("indexCount").textContent = Object.keys(files).length;
editor.addEventListener("beforeinput", pushUndo);
