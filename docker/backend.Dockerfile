# Multi-stage build for Express backend
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files from server directory
COPY server/package*.json ./
COPY server/bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY server/ ./

# Build TypeScript
RUN bun run build

# Production stage
FROM oven/bun:1-alpine

WORKDIR /app

# Copy package files
COPY server/package*.json ./
COPY server/bun.lock* ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Create a non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -S appuser -u 1001

# Create data directory for persistent SQLite databases
RUN mkdir -p /app/data && \
    chown -R appuser:appuser /app/data

# Change ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["bun", "dist/server.js"]

