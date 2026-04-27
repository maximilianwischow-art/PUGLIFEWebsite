# Lightweight production image — Node LTS Alpine
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S app && adduser -S app -u 1001 -G app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY public ./public
USER app
EXPOSE 8787
ENV PORT=8787
CMD ["node", "server.js"]
