FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tools/target-migrations/package.json tools/target-migrations/package.json

RUN pnpm install --filter @pos-platform/target-migrations... --frozen-lockfile

COPY tools/target-migrations tools/target-migrations

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["pnpm", "--filter", "@pos-platform/target-migrations", "central-sync:start"]
