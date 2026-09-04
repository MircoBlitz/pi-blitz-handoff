FROM node:22.19.0-bookworm-slim

RUN mkdir -p /opt/pi /root/.pi/agent \
  && npm install --prefix /opt/pi --no-package-lock --no-save --no-fund --no-audit \
    @earendil-works/pi-coding-agent@0.84.2

ENV PATH="/opt/pi/node_modules/.bin:${PATH}"
WORKDIR /work

ENTRYPOINT ["/bin/sh", "-c"]
