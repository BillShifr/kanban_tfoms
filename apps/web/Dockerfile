FROM docker.io/library/node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @kanban/web --include-workspace-root=false

FROM dependencies AS build
COPY . .
RUN npm run build -w @kanban/web

FROM docker.io/nginx/nginx-unprivileged:1.30.7-alpine@sha256:d7fb82dacc08ff860fc5b05d5608a751b301af9bbe2396350e4fe90ea509b915 AS runtime
COPY --chown=nginx:nginx apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
