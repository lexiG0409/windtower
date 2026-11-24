// 生成"展示版"（只有单人模式，不需要服务器），输出到 docs/ 文件夹，供 GitHub Pages 发布。
// 用法：npm run build:static   （改了题库或网页之后重新运行一次）
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const out = path.join(root, "docs");

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), out, { recursive: true });

// 题库：单人模式从 api/questions 读取
fs.mkdirSync(path.join(out, "api"), { recursive: true });
fs.copyFileSync(path.join(root, "questions.json"), path.join(out, "api", "questions"));

// 网页：去掉联机用的脚本，打上"展示版"标记
const indexPath = path.join(out, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
html = html.replace('<script src="socket.io/socket.io.js"></script>', "<script>window.STATIC_DEMO=true</script>");
if (!html.includes("STATIC_DEMO=true")) throw new Error("没有找到联机脚本标签，展示版生成失败");
fs.writeFileSync(indexPath, html);

// 告诉 GitHub Pages 原样发布，不做额外处理
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log("展示版已生成到 docs/");
