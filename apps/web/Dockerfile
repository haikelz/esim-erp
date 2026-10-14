# syntax=docker/dockerfile:1
ARG BUN_IMAGE=oven/bun:1.3.11-slim@sha256:478281fdd196871c7e51ba6a820b7803a8ae97042ec86cdbc2e1c6b6626442d9
ARG NODE_IMAGE=node:24.21.0-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

FROM ${BUN_IMAGE} AS bun

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ARG TARGETPLATFORM
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN --mount=type=cache,id=bun-web-${TARGETPLATFORM},target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/contracts/src ./packages/contracts/src
RUN mkdir -p apps/web/public && bun run --cwd apps/web build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3010
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/apps/web/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=1000:1000 /app/apps/web/public ./apps/web/public
USER 1000:1000
EXPOSE 3010
CMD ["node", "apps/web/server.js"]
