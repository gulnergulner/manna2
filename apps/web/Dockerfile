FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
COPY schemas schemas
COPY fixtures fixtures
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0
COPY --from=build /app ./
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "apps/web", "--hostname", "0.0.0.0"]
