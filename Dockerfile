# --- build stage ---
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# --- runtime stage ---
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
# Feedback reports may carry the user's PCB file and screenshots; adapter-node's
# default request limit is 512 KB. Keep this above FEEDBACK_LIMITS.maxTotalBytes
# (20 MB) plus multipart overhead.
ENV BODY_SIZE_LIMIT=25M

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080
CMD ["node", "build"]
