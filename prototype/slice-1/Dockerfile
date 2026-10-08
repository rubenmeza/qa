# PROTOTYPE (slice 1): throwaway, see README.md
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
RUN pnpm install && chmod -R a+rX /app
COPY . .
CMD ["sh", "-c", "node_modules/.bin/tsx run.ts && node_modules/.bin/tsx report.ts"]
