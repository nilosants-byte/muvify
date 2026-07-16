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
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
