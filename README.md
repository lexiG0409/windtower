# 风机塔 · 欧洲陆上风电估数挑战

一个用来学习欧洲陆上风电行业知识的答题游戏：输入数字答案，越接近正确答案，风机塔越高（最高 199 米），每局 15 题。

- **单人模式**：按类别自动升级难度（政策 / OEM·技术 / 开发·市场 / 融资，各 3 级）
- **联机对战**：创建房间 → 把链接发给别人 → 所有人同时答同一道题，答完一起揭晓，最后排名

- **手机 App（PWA）**：可以"添加到主屏幕"，有桌面图标、全屏打开；断网时单人模式也能玩

## 文件说明

| 文件 | 作用 |
|---|---|
| `questions.json` | 题库。改题、加题只需要改这个文件 |
| `server.js` | 服务器：管理房间、出题、计时、判分（正确答案只在服务器上） |
| `public/index.html` | 玩家看到的网页 |

### 题目格式

```json
{"c":"policy","l":1,"q":"题目文字","a":115,"u":"GW","r":80,"ex":"揭晓答案后显示的解释"}
```

- `c` 类别：`policy` 政策、`oem` OEM/技术、`dev` 开发/市场、`fin` 融资
- `l` 难度：1、2、3
- `a` 正确答案（数字），`u` 单位
- `r` 误差上限：答案偏差达到这个数，塔高就是 0 米。完全答对 = 199 米
- `ex` 解释

## 在自己电脑上运行

需要先安装 Node.js（18 或更新版本）。

```bash
npm install
npm start
```

然后浏览器打开 http://localhost:3000

## 展示版：GitHub Pages（免费，只有单人模式）

`docs/` 文件夹是不需要服务器的单人展示版，由 `npm run build:static` 生成。
改了题库（`questions.json`）或网页（`public/`）之后，重新运行这条命令再提交，展示版就会更新。

开启方法：仓库 Settings → Pages → Source 选 "Deploy from a branch"，Branch 选 `main`、文件夹选 `/docs` → Save。
几分钟后网址是 `https://<GitHub用户名>.github.io/windtower/`。（免费账号需要仓库是 Public）

## 联机版上线（让任何人打开链接就能玩）

推荐 Render（有免费方案）：

1. 把这个文件夹上传到 GitHub
2. 在 render.com 用 GitHub 登录 → New → Web Service → 选这个仓库
3. Build Command 填 `npm install`，Start Command 填 `npm start`，选 Free
4. 部署完成后会得到一个 `https://xxx.onrender.com` 的网址，发给别人即可

注意：免费方案在 15 分钟没人访问后会休眠，下次打开要等 30–60 秒唤醒。

## 设置项（环境变量）

所有设置都不用改代码，在部署平台或服务器上设置环境变量即可。完整列表见 `.env.example`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 3000 | 程序监听的端口 |
| `BASE_PATH` | （空） | 挂在子路径下时填写，例如 `/windtower` |
| `TRUST_PROXY` | false | 放在 nginx 等反向代理后面时设为 `true` |
| `QUESTIONS_FILE` | questions.json | 题库文件位置 |
| `QUESTIONS_PER_MATCH` / `ANSWER_SECONDS` / `REVEAL_SECONDS` / `MAX_PLAYERS_PER_ROOM` | 15 / 25 / 7 / 30 | 游戏节奏 |

## 部署到公司服务器（给 IT 同事看）

**技术概况**：Node.js 20 + Express + Socket.IO，单进程，无数据库，房间状态保存在内存中。
不加载任何外部 CDN、字体或统计脚本，可在内网离线运行。不收集个人数据（只有玩家自己填的昵称，房间结束后丢弃），不使用 Cookie。

**方式一：Docker（推荐）**

```bash
docker build -t windtower .
docker run -d --restart unless-stopped -p 3000:3000 \
  -e BASE_PATH=/windtower -e TRUST_PROXY=true --name windtower windtower
```

**方式二：直接运行**：服务器装好 Node.js 20 后 `npm ci --omit=dev && npm start`，建议用 systemd 或 pm2 保持常驻。

**健康检查**：`GET {BASE_PATH}/health` 返回 `{"ok":true,...}`。

**nginx 反向代理示例**（必须转发 WebSocket 升级头，否则联机会退化成较慢的轮询）：

```nginx
location /windtower/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
```

**注意事项**

- 必须使用 HTTPS，否则手机无法"添加到主屏幕"（PWA 的要求）。
- 只能运行**一个实例**，因为房间保存在内存里。若将来要多实例负载均衡，需要加 Redis（Socket.IO Redis adapter）并开启粘性会话。
- 重启程序会清空正在进行的对局（程序会先通知玩家）。
- 如果公司防火墙拦截 WebSocket，Socket.IO 会自动改用普通 HTTP 轮询，仍可使用。
