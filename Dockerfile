FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/firebase-applet-config.json ./
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "server.ts"]
