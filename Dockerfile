# Dev/CI image: build, typecheck and test the engine without installing Node,
# pnpm or any dependency on the host — everything stays inside the container, so
# `make clean` (or `docker compose down --rmi local`) leaves the machine spotless.
FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["pnpm", "test"]
