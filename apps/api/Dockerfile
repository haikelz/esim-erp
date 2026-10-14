# syntax=docker/dockerfile:1
ARG BUN_IMAGE=oven/bun:1.3.11-slim@sha256:478281fdd196871c7e51ba6a820b7803a8ae97042ec86cdbc2e1c6b6626442d9

FROM ${BUN_IMAGE} AS deps
WORKDIR /app
ARG TARGETPLATFORM
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN --mount=type=cache,id=bun-api-${TARGETPLATFORM},target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS build
COPY apps/api/src ./apps/api/src
COPY apps/api/migrations ./apps/api/migrations
COPY packages/contracts/src ./packages/contracts/src
RUN bun build ./apps/api/src/bun-runtime.ts --target=bun --minify --outfile=dist/server.js && \
    bun build ./apps/api/src/migrate-runtime.ts --target=bun --minify --outfile=dist/migrate.js

FROM ${BUN_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3011
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/dist/server.js ./server.js
COPY --from=build --chown=1000:1000 /app/dist/migrate.js ./migrate.js
COPY --from=build --chown=1000:1000 /app/apps/api/migrations ./migrations
USER 1000:1000
EXPOSE 3011
CMD ["bun", "/app/server.js"]
