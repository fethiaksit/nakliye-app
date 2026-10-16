# Multi-stage build optimized for ARM64 & low memory footprint (~900MB RAM host)
FROM node:22-alpine AS builder

WORKDIR /app

# Ensure standard compatibility libraries exist
RUN apk add --no-cache libc6-compat

# Copy shared library referenced via relative path ../../shared
COPY shared /app/shared

# Copy admin-panel package definitions
WORKDIR /app/admin-panel
COPY admin-panel/package.json admin-panel/package-lock.json ./

# Limit memory usage for V8 engine during build to prevent OOM
ENV NODE_OPTIONS="--max-old-space-size=384"

# Clean dependency install
RUN npm ci

# Copy admin-panel source code
COPY admin-panel ./

# Build arguments for public API URLs (baked into client bundles by Vite/Vinext)
ARG NEXT_PUBLIC_ADMIN_API_URL="https://beta-api-18-157-76-136.sslip.io/api/admin"
ARG NEXT_PUBLIC_API_URL="https://beta-api-18-157-76-136.sslip.io"
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_ADMIN_API_URL=${NEXT_PUBLIC_ADMIN_API_URL}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}

# Build production assets
RUN npm run build

# Runner stage
FROM node:22-alpine AS runner

WORKDIR /app/admin-panel

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=384"

# Security best practice: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 vinext

# Copy shared module needed by runtime
COPY --from=builder --chown=vinext:nodejs /app/shared /app/shared

# Copy built application and runtime dependencies
COPY --from=builder --chown=vinext:nodejs /app/admin-panel/package.json ./package.json
COPY --from=builder --chown=vinext:nodejs /app/admin-panel/node_modules ./node_modules
COPY --from=builder --chown=vinext:nodejs /app/admin-panel/dist ./dist

# Create runtime directory for logs if needed
RUN mkdir -p .wrangler && chown -R vinext:nodejs .wrangler

USER vinext

EXPOSE 3000

# Health check against static route
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/privacy || exit 1

CMD ["node", "node_modules/vinext/dist/cli.js", "start", "-p", "3000", "-H", "0.0.0.0"]
