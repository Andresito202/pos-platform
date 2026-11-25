# Portable Central Authority runtime; tests and fixtures are excluded from the build context.
# Does not publish to a registry. Secrets via runtime env/files, never baked in.
FROM node:22.19.0-bookworm-slim AS dependencies

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Build the workspace from the locked source tree.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/central-authority ./apps/central-authority
COPY packages ./packages
COPY tools/target-migrations ./tools/target-migrations
COPY apps/pos-local-service/package.json ./apps/pos-local-service/package.json
COPY apps/pos-desktop/package.json ./apps/pos-desktop/package.json

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
  && pnpm install --frozen-lockfile --filter @pos-platform/central-authority... --filter @pos-platform/target-migrations...

FROM node:22.19.0-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --create-home pos
COPY --from=dependencies --chown=pos:pos /app /app

USER pos
ENV NODE_ENV=production \
    CENTRAL_AUTHORITY_PORT=8443 \
    OTEL_ENABLE_API=0

WORKDIR /app/apps/central-authority
EXPOSE 8443
CMD ["node", "--import", "tsx", "src/main.ts"]
