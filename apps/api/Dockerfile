FROM docker.io/library/node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @kanban/api --include-workspace-root=false

FROM dependencies AS build
COPY . .
RUN npm run build -w @kanban/api

FROM docker.io/library/node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace @kanban/api --include-workspace-root=false

FROM docker.io/library/node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=build /app/apps/api/package.json apps/api/package.json
COPY --chown=node:node --from=build /app/apps/api/dist apps/api/dist
COPY --chown=node:node --from=build /app/apps/api/drizzle apps/api/drizzle
RUN mkdir -p /app/data/uploads && chown node:node /app/data/uploads
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=12 CMD ["node", "apps/api/dist/healthcheck.js"]
CMD ["sh", "-c", "node apps/api/dist/migrate.js && exec node apps/api/dist/server.js"]
