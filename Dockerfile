FROM node:20-alpine AS deps
WORKDIR /app
# python3/make/g++ are needed to compile bcrypt's native addon from source —
# Alpine (musl libc) isn't covered by bcrypt's prebuilt binaries, unlike glibc
# Linux. Only needed in this stage; the runtime image never installs them.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Frente 14 (segunda camada, carga real), Lote 4: default do libuv (4) é
# compartilhado por TODO trabalho assíncrono em thread nativa do processo —
# inclui bcrypt.hash/compare (BCRYPT_ROUNDS=12, ~200-300ms de CPU por
# chamada) E a compressão gzip assíncrona por trás de app.use(compression())
# em src/app.ts, aplicada a toda resposta da API. Sob pico real (logins e
# tráfego normal coincidindo), as 4 threads ficam disputadas entre os dois,
# somando latência aos dois ao mesmo tempo — efeito que não aparece sob a
# baixa concorrência da suíte de teste.
ENV UV_THREADPOOL_SIZE=8
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/docs ./docs
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
