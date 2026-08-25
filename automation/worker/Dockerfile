FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.144.6

RUN apt-get update \
	&& apt-get install -y --no-install-recommends bubblewrap ca-certificates curl git ripgrep \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install --global "@openai/codex@${CODEX_VERSION}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY templates ./templates
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /data /home/node/.codex \
	&& chown -R node:node /app /data /home/node/.codex \
	&& chown root:root /app/docker-entrypoint.sh \
	&& chmod 700 /app/docker-entrypoint.sh

ENV CODEX_HOME=/home/node/.codex
ENV NODE_ENV=production

EXPOSE 8787

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "src/server.mjs"]
