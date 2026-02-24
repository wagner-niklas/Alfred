# ==============================
# Builder stage
# ==============================
FROM node:25-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ==============================
# Production runner stage
# ==============================
FROM gcr.io/distroless/nodejs24-debian13 AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY .env.local .env

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

# Start Next.js server
CMD ["server.js"]