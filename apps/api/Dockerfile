# ============================================================================
# API production image — multi-stage build.
# Stage 1 compiles TypeScript; stage 2 ships only the built output + prod deps,
# so the final image is smaller and doesn't carry the toolchain.
# ============================================================================

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
# Install ALL deps (incl. dev) so we can compile.
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Only production deps in the final image.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# Copy the compiled JS from the build stage.
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main.js"]
