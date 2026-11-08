# Central is a stateful HTTPS Node server, not a Vercel Function.
# Build from the repository root; pass operational secrets only at runtime
# using read-only mounts and a secret manager (never build args or image ENV).
FROM node:22.19.0-bookworm-slim
WORKDIR /srv/camacho-pos
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile --prod=false && \
    pnpm --filter @pos-platform/central-authority typecheck
ENV NODE_ENV=production
USER node
EXPOSE 8443
CMD ["pnpm", "--filter", "@pos-platform/central-authority", "start"]
