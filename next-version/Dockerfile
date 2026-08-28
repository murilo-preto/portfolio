
# ---------- Base ----------
FROM node:20-alpine AS base
WORKDIR /app

# ---------- Dependencies ----------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Build ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- Test ----------
# Inherits the builder's node_modules, which npm ci installs with devDependencies
# included, so vitest is already here. Used by the `nextjs-test` service in
# docker-compose.test.yml; not part of the image that ships.
FROM builder AS test
CMD ["npm", "test"]

# ---------- Runner ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 5000

CMD ["node", "server.js"]
