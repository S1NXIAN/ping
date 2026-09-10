# PING on Bun. The SQLite DB is baked in empty at build time on purpose:
# free-tier storage is ephemeral either way (resets every deploy/sleep),
# so there is nothing to preserve — this keeps boot fast with no migrate step.
FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV DATABASE_URL="file:/tmp/ping.db"
RUN bunx prisma generate \
  && bun run build \
  && bunx prisma db push --accept-data-loss

FROM oven/bun:1.4.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production DATABASE_URL="file:/tmp/ping.db"
COPY --from=build /tmp/ping.db /tmp/ping.db
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 10000
CMD ["bun", "server.js"]
