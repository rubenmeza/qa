FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod && chmod -R a+rX /app
COPY src ./src
ENTRYPOINT ["node", "--import", "tsx", "/app/src/cli.ts"]
