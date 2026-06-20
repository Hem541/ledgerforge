# ============================================================================
# Web (Next.js) production image — multi-stage build using standalone output.
# ============================================================================

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
# Build-time proxy target. Next.js bakes rewrites() at build time, so the API
# URL must be available HERE, not just at runtime.
ARG API_PROXY_TARGET=http://localhost:3001
ENV API_PROXY_TARGET=$API_PROXY_TARGET
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
