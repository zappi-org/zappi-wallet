# Build stage
FROM oven/bun:1 AS builder

# Release channel (main | staging | nightly) — controls invite gate config.
ARG VITE_ZAPPI_CHANNEL=main
# Comma-separated invite codes; empty = open beta.
ARG VITE_ZAPPI_INVITE_CODES=
ENV VITE_ZAPPI_CHANNEL=$VITE_ZAPPI_CHANNEL
ENV VITE_ZAPPI_INVITE_CODES=$VITE_ZAPPI_INVITE_CODES

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen

# Copy source code
COPY . .

# CI checks
RUN bun run lint
RUN bun run test:run

# Build the app
RUN bun run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config (full http{} block; replaces main config)
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy server-side assets (OG image, bot HTML) — never bundled into client build.
# Vite ignores anything outside its root + publicDir, so these stay server-only.
COPY --from=builder /app/server-assets /usr/share/nginx/server-assets

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
