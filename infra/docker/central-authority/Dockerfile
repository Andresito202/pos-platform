# Portable Central Authority image — lab/staging prep only.
# Does not publish to a registry. Secrets via runtime env/files, never baked in.
FROM node:22.19.0-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --create-home pos

# Expect a pre-built workspace context (pnpm deploy or CI artifact). Copy lock+manifests first.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/central-authority ./apps/central-authority
COPY packages ./packages
COPY tools/target-migrations ./tools/target-migrations

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
  && pnpm install --frozen-lockfile --filter @pos-platform/central-authority... \
  && chown -R pos:pos /app

USER pos
ENV NODE_ENV=production \
    CENTRAL_AUTHORITY_PORT=8443 \
    OTEL_ENABLE_API=0

EXPOSE 8443
CMD ["pnpm", "--filter", "@pos-platform/central-authority", "start"]
