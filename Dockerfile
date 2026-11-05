# Marks server for a long-lived machine. Build on a computer with a few
# gigabytes of RAM. A Google Cloud e2-micro can run the image and cannot build it.
FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10.29.1 --activate

WORKDIR /marks
COPY agent/package.json agent/pnpm-lock.yaml agent/pnpm-workspace.yaml agent/
WORKDIR /marks/agent
RUN pnpm install --frozen-lockfile

COPY agent/ /marks/agent/
RUN pnpm build

FROM node:22-bookworm-slim

ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl python3 \
  && case "${TARGETARCH}" in \
       amd64) ASSET=near-cli-rs-x86_64-unknown-linux-gnu.tar.gz ;; \
       arm64) ASSET=near-cli-rs-aarch64-unknown-linux-gnu.tar.gz ;; \
       *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL -o /tmp/near.tgz "https://github.com/near/near-cli-rs/releases/download/v0.30.1/${ASSET}" \
  && tar -xzf /tmp/near.tgz -C /tmp \
  && mv /tmp/near-cli-rs-*/near /usr/local/bin/near \
  && chmod 755 /usr/local/bin/near \
  && rm -rf /tmp/near.tgz /tmp/near-cli-rs-* \
  && rm -rf /var/lib/apt/lists/* \
  && near --version

WORKDIR /marks
COPY scripts/ /marks/scripts/
COPY --from=build /marks/agent /marks/agent
COPY docker/near-cli-config.toml /opt/marks/near-cli-config.toml
COPY docker/write-key.mjs /opt/marks/write-key.mjs
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod 755 /entrypoint.sh \
  && mkdir -p /marks/agent/data \
  && ln -sfn /marks/.env /marks/agent/.env

ENV HOME=/root \
  HOST=0.0.0.0 \
  PORT=3000 \
  NODE_ENV=production \
  NODE_OPTIONS=--max-old-space-size=512

EXPOSE 3000
VOLUME /marks/agent/data
ENTRYPOINT ["/entrypoint.sh"]
