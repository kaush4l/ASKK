ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
FROM ${NODE_IMAGE} AS pty
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/harness
RUN npm install --omit=dev --ignore-scripts=false --save-exact node-pty@1.1.0

FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git procps util-linux && rm -rf /var/lib/apt/lists/*
COPY --from=pty /opt/harness/node_modules /opt/harness/node_modules
COPY supervisor.js /opt/harness/supervisor.js
COPY template /opt/harness/template
RUN npm ci --prefix /opt/harness/template --no-audit --no-fund && rm -rf /root/.npm/_cacache /root/.npm/_logs
COPY prepare-template.js npm-guard.cjs /opt/harness/
RUN chmod 755 /opt/harness/npm-guard.cjs && ln -sf /opt/harness/npm-guard.cjs /usr/local/bin/npm
RUN mkdir -p /workspace /harness-control && chmod 1777 /workspace
ENV HARNESS_WORKSPACE=/workspace HARNESS_MAILBOX=/harness-control
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/harness/supervisor.js"]
