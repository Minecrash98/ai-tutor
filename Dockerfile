ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:af85d11ce7ef10172855a6e3649e3e8125b1b9e3ca41849ec2918036f05cb212

FROM ${NODE_IMAGE} AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN npm install --global corepack@0.34.0 \
  && corepack enable \
  && corepack prepare pnpm@10.12.3 --activate

FROM base AS build

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runtime-filesystem

RUN mkdir -p /runtime-root/data/logs /runtime-root/app/apps/web/.next/cache \
  && chown -R 1000:1000 /runtime-root

# Migration is a separate minimal, one-shot target. It carries only the
# frozen SQL journal, the small runner, and postgres.js; no source tree,
# compiler, package manager, or development dependency is shipped.
FROM ${RUNTIME_IMAGE} AS migration

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres ./node_modules/postgres
COPY --from=build --chown=1000:1000 /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=build --chown=1000:1000 /app/scripts/run-migrations.mjs ./scripts/run-migrations.mjs
USER 1000:1000
CMD ["scripts/run-migrations.mjs"]

FROM ${RUNTIME_IMAGE} AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV AI_TUTOR_LOG_DIR=/data/logs
WORKDIR /app

LABEL org.opencontainers.image.title="AI Tutor" \
  org.opencontainers.image.version="0.1.0" \
  org.opencontainers.image.description="Deterministic HTML/CSS learning canvas" \
  org.opencontainers.image.licenses="SEE THIRD_PARTY_NOTICES.md"

COPY --from=runtime-filesystem --chown=1000:1000 /runtime-root/ /
COPY --from=build --chown=1000:1000 /app/apps/web/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=1000:1000 /app/apps/web/public ./apps/web/public
COPY --from=build --chown=1000:1000 /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --from=build --chown=1000:1000 /app/licenses/tldraw-v3.15.5-LICENSE.md ./licenses/tldraw-v3.15.5-LICENSE.md
COPY --from=build --chown=1000:1000 /app/evidence/P8_LICENSE_INVENTORY_2026-08-02.json ./evidence/P8_LICENSE_INVENTORY_2026-08-02.json
COPY --from=build --chown=1000:1000 /app/evidence/P8_SBOM_2026-08-02.cdx.json ./evidence/P8_SBOM_2026-08-02.cdx.json
COPY --from=build --chown=1000:1000 /app/scripts/container-health-check.mjs ./scripts/container-health-check.mjs

USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["apps/web/server.js"]
