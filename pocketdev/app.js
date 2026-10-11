/* ================= PocketDev 核心逻辑 ================= */

// ---------- 项目文件系统（内存版） ----------
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

const files = { "index.html": DEFAULT_HTML };
let activeFile = "index.html";
let undoStack = [];
let tokens = 0, builds = 4, saved = 0, memories = 0, workTreeOn = false;

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
  updateLineNums();
  renderTabs();
}

function addFile() {
  const name = prompt("新建文件名（如 page.html / style.css / app.js）");
  if (!name) return;
  if (files[name]) { toast("文件已存在"); return; }
  files[name] = name.endsWith(".css") ? "/* 样式 */" : name.endsWith(".js") ? "// 脚本" : DEFAULT_HTML;
  switchFile(name);
  toast("已创建 " + name);
}

function closeFile(name) {
  delete files[name];
  if (activeFile === name) switchFile("index.html");
  renderTabs();
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
  refreshPreview();
  toast("已保存并刷新预览");
}
$("btnSave").onclick = save;

$("btnUndo").onclick = () => {
  const prev = undoStack.pop();
  if (prev !== undefined) { editor.value = prev; files[activeFile] = prev; updateLineNums(); }
  else toast("没有可撤销的修改");
};

function pushUndo() { undoStack.push(editor.value); if (undoStack.length > 50) undoStack.shift(); }

// ---------- 预览 ----------
function refreshPreview() {
  // 把 css/js 文件简单内联进 index.html
  let html = files["index.html"] || "";
  const css = Object.keys(files).filter(f => f.endsWith(".css")).map(f => files[f]).join("\n");
  const js = Object.keys(files).filter(f => f.endsWith(".js")).map(f => files[f]).join("\n");
  if (css) html = html.replace("</head>", `<style>${css}</style></head>`);
  if (js) html = html.replace("</body>", `<script>${js}<\/script></body>`);
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
document.querySelectorAll(".mnav-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".mnav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("mobile-active"));
    $("panel-" + btn.dataset.panel).classList.add("mobile-active");
  };
});
if (window.innerWidth <= 900) $("panel-editor").classList.add("mobile-active");
else $("panel-editor").classList.add("mobile-active"); // 桌面默认全部可见

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

// ---------- 端侧 AI 代码生成（本地模拟） ----------
function generateFromPrompt(text) {
  pushUndo();

  if (/番茄钟|pomodoro|计时/.test(text)) {
    files["index.html"] = POMODORO_HTML;
    return {
      userMsg: "已为你生成「番茄钟」🍅\n包含 25 分钟专注倒计时、开始/暂停/重置，已自动刷新预览。",
      assistMsg: "生成说明：\n1. 单文件实现，无外部依赖，离线可用\n2. requestAnimationFrame 驱动倒计时\n3. 切换到「预览」即可使用"
    };
  }
  if (/商城|购物|登录|电商|shop|mall/.test(text)) {
    files["index.html"] = MALL_HTML;
    return {
      userMsg: "已为你生成「商城」🛍️\n包含登录页 + 首页商品列表 + 底部导航，点击预览体验完整流程。",
      assistMsg: "生成说明：\n1. 登录页：手机号 + 验证码 UI\n2. 首页：商品卡片网格 + 搜索栏\n3. 纯本地模拟登录态，可离线运行"
    };
  }
  // 默认：生成一个落地页
  files["index.html"] = landingHTML(text);
  return {
    userMsg: `已根据「${text.slice(0, 20)}」生成一个单页应用骨架，可在代码区继续修改。`,
    assistMsg: "生成说明：\n1. 已写入 index.html 并刷新预览\n2. 说「加一个 XX 页面」可继续迭代\n3. 点黄色 ✓ 保存到工作树"
  };
}

function landingHTML(title) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title.slice(0, 12)}</title>
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
    <h1>${title.slice(0, 20)}</h1>
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
  /* 登录页 */
  #login { display:flex; flex-direction:column; justify-content:center; padding:40px 28px; background:linear-gradient(160deg,#2f6bff,#7a5cff); min-height:100vh; }
  #login h1 { color:#fff; font-size:26px; margin-bottom:6px; }
  #login p { color:rgba(255,255,255,.8); font-size:14px; margin-bottom:34px; }
  #login input { width:100%; border:none; border-radius:12px; padding:15px 16px; margin-bottom:14px; font-size:15px; background:rgba(255,255,255,.95); }
  #loginBtn { width:100%; border:none; border-radius:12px; padding:15px; font-size:16px; font-weight:600; background:#ffd94d; color:#5a4a00; }
  /* 首页 */
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

// ---------- 右栏：开关 / 打包 ----------
$("workTreeSwitch").onchange = e => {
  workTreeOn = e.target.checked;
  toast(workTreeOn ? "永久工作树已开启：项目将写入手机存储" : "永久工作树已关闭");
};

$("memBtn").onclick = () => toast(`长期记忆 ${memories} 条 · 已索引文件 ${Object.keys(files).length} 个`);

$("buildCard").onclick = e => {
  if (e.target.closest("button")) return;
  const state = $("buildState");
  if (state.textContent === "打包中") return;
  state.textContent = "打包中";
  $("buildProgress").classList.remove("hidden");
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
      $("savedCount").textContent = saved + " 元";
      toast("🎉 APK 打包完成");
    }
    $("buildInner").style.width = p + "%";
  }, 350);
};

// ---------- 初始化 ----------
editor.value = files[activeFile];
updateLineNums();
renderTabs();
refreshPreview();
editor.addEventListener("beforeinput", pushUndo);
