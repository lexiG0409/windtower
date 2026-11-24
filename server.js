// 风机塔 · 服务器
// 作用：1) 把网页发给玩家  2) 管理对战房间：出题、计时、收答案、公布结果
// 正确答案只保存在服务器上，答题时玩家的浏览器拿不到，防止作弊。
//
// 所有可调整的设置都通过"环境变量"传入（见 README 的「设置项」），
// 换服务器（Render → 公司服务器）时只改设置，不用改代码。

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const CONFIG = {
  port: Number(env("PORT", 3000)),
  host: env("HOST", "0.0.0.0"),
  // 网站挂在哪个路径下，例如公司服务器上是 https://intranet.firma.de/windtower/ 就填 /windtower
  basePath: ("/" + env("BASE_PATH", "").replace(/^\/+|\/+$/g, "")).replace(/^\/$/, ""),
  questionsFile: path.resolve(__dirname, env("QUESTIONS_FILE", "questions.json")),
  questionsPerMatch: Number(env("QUESTIONS_PER_MATCH", 15)),
  answerSeconds: Number(env("ANSWER_SECONDS", 25)),
  revealSeconds: Number(env("REVEAL_SECONDS", 7)),
  maxPlayersPerRoom: Number(env("MAX_PLAYERS_PER_ROOM", 30)),
  maxHeight: 199,
  // 放在公司的反向代理（如 nginx）后面时设为 true，才能拿到真实访问地址
  trustProxy: env("TRUST_PROXY", "false") === "true",
};

function loadBank() {
  const bank = JSON.parse(fs.readFileSync(CONFIG.questionsFile, "utf8"));
  // 每道题的题目(q)、解释(ex)、单位(u) 都要有 10 种语言（和网页右上角的语言菜单一致）
  const LANGS = ["zh", "en", "de", "es", "fr", "pl", "it", "pt", "nl", "sv"];
  const hasAll = o => o && typeof o === "object" && LANGS.every(l => typeof o[l] === "string");
  const bad = bank.filter(q => !hasAll(q.q) || !hasAll(q.ex) || !hasAll(q.u) || typeof q.a !== "number" || !(q.r > 0) || ![1, 2, 3].includes(q.l));
  if (bad.length) throw new Error(`题库里有 ${bad.length} 道题格式不对，例如：${JSON.stringify(bad[0]).slice(0, 120)}`);
  return bank;
}
const BANK = loadBank();
const N = CONFIG.questionsPerMatch;
const ANSWER_SECONDS = CONFIG.answerSeconds;
const REVEAL_SECONDS = CONFIG.revealSeconds;
const MAX_H = CONFIG.maxHeight;

const app = express();
if (CONFIG.trustProxy) app.set("trust proxy", true);
app.disable("x-powered-by");

const site = express.Router();
site.use(express.static(path.join(__dirname, "public")));
// 单人模式用的题库（单人模式在玩家自己的浏览器里判分）
site.get("/api/questions", (req, res) => res.json(BANK));
// 健康检查：服务器管理员 / 部署平台用来确认程序还活着
site.get("/health", (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));

if (CONFIG.basePath) {
  // /windtower → /windtower/ （网页里的地址是相对路径，需要结尾的斜杠）
  app.get(CONFIG.basePath, (req, res, next) => (req.path === CONFIG.basePath ? res.redirect(301, CONFIG.basePath + "/") : next()));
  app.use(CONFIG.basePath, site);
} else {
  app.use(site);
}

const server = http.createServer(app);
const io = new Server(server, { path: CONFIG.basePath + "/socket.io" });

function heightFor(q, g) {
  if (g === null || g === undefined || Number.isNaN(g)) return 0;
  const d = Math.min(1, Math.abs(g - q.a) / q.r);
  return Math.round(MAX_H * Math.pow(1 - d, 2));
}
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 对战难度：房主在房间里选择。数字是 Lv1 / Lv2 / Lv3 各占的比例
const DIFFICULTY = {
  easy:     [2, 1, 0], // 简单：以 Lv1 为主，夹一些 Lv2
  standard: [1, 1, 1], // 标准：三个等级各占三分之一
  hard:     [0, 1, 2], // 困难：以 Lv3 为主，夹一些 Lv2
};
// 按难度挑 N 道题，由易到难排列。某个等级题目不够时，从相邻等级补足
function pickMatch(difficulty) {
  const w = DIFFICULTY[difficulty] || DIFFICULTY.standard;
  const sum = w.reduce((a, b) => a + b, 0);
  const want = w.map(x => Math.floor((N * x) / sum));
  want[w.indexOf(Math.max(...w))] += N - want.reduce((a, b) => a + b, 0); // 除不尽的余数给占比最大的等级
  const pools = [1, 2, 3].map(l => shuffle(BANK.filter(q => q.l === l)));
  const out = [];
  want.forEach((n, i) => out.push(...pools[i].splice(0, n)));
  // 补足：优先从离目标难度最近的等级拿
  const order = difficulty === "hard" ? [2, 1, 0] : difficulty === "easy" ? [0, 1, 2] : [1, 0, 2];
  for (const i of order) while (out.length < N && pools[i].length) out.push(pools[i].shift());
  return out.sort((a, b) => a.l - b.l).slice(0, N);
}
function newCode() {
  const s = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;
  do c = Array.from({ length: 5 }, () => s[Math.floor(Math.random() * s.length)]).join("");
  while (rooms.has(c));
  return c;
}

const rooms = new Map(); // code -> room

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase, // lobby | question | reveal | end
    difficulty: room.difficulty,
    index: room.index,
    total: N,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, total: p.heights.reduce((a, b) => a + b, 0),
      answered: room.answers.has(p.id), online: p.online
    })).sort((a, b) => b.total - a.total)
  };
}
function broadcast(room) { io.to(room.code).emit("state", publicState(room)); }

function askQuestion(room) {
  clearTimeout(room.timer);
  if (room.index >= N) return endMatch(room);
  room.phase = "question";
  room.answers = new Map();
  const q = room.qs[room.index];
  room.deadline = Date.now() + ANSWER_SECONDS * 1000;
  io.to(room.code).emit("question", {
    index: room.index, total: N, c: q.c, l: q.l, q: q.q, u: q.u,
    seconds: ANSWER_SECONDS, deadline: room.deadline
  });
  broadcast(room);
  room.timer = setTimeout(() => reveal(room), ANSWER_SECONDS * 1000 + 300);
}
function reveal(room) {
  if (room.phase !== "question") return;
  clearTimeout(room.timer);
  room.phase = "reveal";
  const q = room.qs[room.index];
  const results = [];
  for (const p of room.players.values()) {
    const g = room.answers.has(p.id) ? room.answers.get(p.id) : null;
    const h = heightFor(q, g);
    p.heights[room.index] = h;
    results.push({ id: p.id, name: p.name, guess: g, height: h });
  }
  results.sort((a, b) => b.height - a.height);
  io.to(room.code).emit("reveal", { index: room.index, a: q.a, u: q.u, ex: q.ex, results, seconds: REVEAL_SECONDS });
  room.index++;
  broadcast(room);
  room.timer = setTimeout(() => askQuestion(room), REVEAL_SECONDS * 1000);
}
function endMatch(room) {
  room.phase = "end";
  io.to(room.code).emit("end", {
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, heights: p.heights, total: p.heights.reduce((a, b) => a + (b || 0), 0)
    })).sort((a, b) => b.total - a.total)
  });
  broadcast(room);
}
function cleanName(n) { return String(n || "玩家").trim().slice(0, 16) || "玩家"; }

io.on("connection", socket => {
  let room = null;
  // 每个浏览器自带一个固定 id（存在本机），刷新页面后还能回到原来的位置
  const pid = String(socket.handshake.auth?.pid || socket.id).slice(0, 40);

  function join(r, name) {
    room = r;
    socket.join(r.code);
    let p = r.players.get(pid);
    if (!p) { p = { id: pid, name: cleanName(name), heights: [], online: true }; r.players.set(pid, p); }
    p.online = true; p.name = cleanName(name);
    socket.emit("joined", { code: r.code, you: pid });
    broadcast(r);
    // 中途加入/刷新：补发当前题目
    if (r.phase === "question") {
      const q = r.qs[r.index];
      socket.emit("question", { index: r.index, total: N, c: q.c, l: q.l, q: q.q, u: q.u, seconds: ANSWER_SECONDS, deadline: r.deadline });
    }
  }

  socket.on("create", ({ name }) => {
    const code = newCode();
    const r = { code, hostId: pid, players: new Map(), phase: "lobby", difficulty: "standard", index: 0, qs: [], answers: new Map(), timer: null };
    rooms.set(code, r);
    join(r, name);
  });

  socket.on("join", ({ code, name }) => {
    const r = rooms.get(String(code || "").toUpperCase().trim());
    if (!r) return socket.emit("err", "room_not_found");
    if (r.players.size >= CONFIG.maxPlayersPerRoom && !r.players.has(pid)) return socket.emit("err", "room_full");
    join(r, name);
  });

  socket.on("start", () => {
    if (!room || room.hostId !== pid) return;
    if (room.phase !== "lobby" && room.phase !== "end") return;
    room.qs = pickMatch(room.difficulty); room.index = 0;
    for (const p of room.players.values()) p.heights = [];
    askQuestion(room);
  });

  // 房主在开始前（或一局结束后）选择难度
  socket.on("difficulty", ({ value }) => {
    if (!room || room.hostId !== pid || !DIFFICULTY[value]) return;
    if (room.phase !== "lobby" && room.phase !== "end") return;
    room.difficulty = value;
    broadcast(room);
  });

  socket.on("answer", ({ value }) => {
    if (!room || room.phase !== "question" || room.answers.has(pid)) return;
    const g = value === null || value === "" ? null : Number(value);
    room.answers.set(pid, Number.isFinite(g) ? g : null);
    broadcast(room);
    const online = [...room.players.values()].filter(p => p.online);
    if (online.every(p => room.answers.has(p.id))) reveal(room); // 所有人都答完就提前公布
  });

  socket.on("disconnect", () => {
    if (!room) return;
    const p = room.players.get(pid);
    if (p) p.online = false;
    // 房主掉线：把房主交给下一个在线玩家
    if (room.hostId === pid) {
      const next = [...room.players.values()].find(x => x.online);
      if (next) room.hostId = next.id;
    }
    broadcast(room);
    const r = room;
    // 所有人都离开 30 分钟后，删除房间
    setTimeout(() => {
      if (![...r.players.values()].some(x => x.online)) { clearTimeout(r.timer); rooms.delete(r.code); }
    }, 30 * 60 * 1000);
  });
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`风机塔已启动：http://localhost:${CONFIG.port}${CONFIG.basePath}/  （题库 ${BANK.length} 题）`);
});

// 服务器重启/关机时，先通知玩家再退出
function shutdown(sig) {
  console.log(`收到 ${sig}，正在关闭…`);
  io.emit("err", "server_restart");
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
