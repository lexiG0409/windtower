# 把游戏打包成一个"集装箱"（Docker 镜像），公司服务器上一条命令就能运行
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}${BASE_PATH}/health" || exit 1
CMD ["node", "server.js"]
