FROM node:18-bullseye-slim AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.ts tsconfig.json tsconfig.main.json postcss.config.js tailwind.config.js ./
COPY src ./src
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build:renderer

FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.10 AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY --from=frontend-builder /app/dist/renderer /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 7860
CMD ["/app/start.sh"]
