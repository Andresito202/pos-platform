# Build reviewed source and native dependencies without embedding credentials.
FROM node:22.19.0-bookworm-slim AS builder
WORKDIR /srv/camacho-pos
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY . .
RUN pnpm --filter @pos-platform/central-authority... install --frozen-lockfile --prod=false && \
    pnpm --filter @pos-platform/central-authority typecheck

# Runtime contains no compiler or credentials. Secret files are read-only mounts.
FROM node:22.19.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv/camacho-pos
# Runtime package manager must not download into a read-only HOME.
RUN corepack disable && npm install -g pnpm@9.15.0
COPY --from=builder --chown=node:node /srv/camacho-pos/ /srv/camacho-pos/
USER node
EXPOSE 8443
CMD ["pnpm", "--filter", "@pos-platform/central-authority", "start"]
