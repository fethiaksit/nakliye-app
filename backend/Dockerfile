# Multi-stage hardened production Dockerfile for NakliyeGo Backend API
FROM golang:1.25-alpine AS builder

WORKDIR /src

# Install CA certificates and timezone data
RUN apk add --no-cache ca-certificates tzdata

# Cache Go modules
COPY go.mod go.sum ./
RUN go mod download

# Copy backend source
COPY . .

# Build statically linked binary with stripped debug symbols
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/nakliye-api ./cmd/api

# Minimal runtime stage
FROM alpine:3.21 AS runner

RUN apk add --no-cache ca-certificates tzdata wget && \
    addgroup -S -g 10001 nakliye && \
    adduser -S -u 10001 -G nakliye nakliye

WORKDIR /app

COPY --from=builder --chown=nakliye:nakliye /out/nakliye-api /app/nakliye-api

USER nakliye:nakliye

EXPOSE 8080

# Readiness healthcheck verifies both API process and Redis dependency
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/health/ready || exit 1

ENTRYPOINT ["/app/nakliye-api"]
