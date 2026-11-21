# ایمیج رسمی Playwright: Chromium + همه کتابخانه‌های سیستمی لازم را دارد
# نسخه با patchright هماهنگ است (patchright 1.64 → chromium همین ایمیج)
FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /app
ENV NODE_ENV=production \
    HEADLESS=1 \
    DATA_DIR=/data \
    PORT=8080 \
    TZ=Asia/Tehran

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && npm prune --omit=dev

VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.js"]
