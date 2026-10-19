# One image for the whole site: the frontend is built first, then the backend
# serves it together with the API (see the end of backend/app/main.py).

FROM node:24-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# The address printed inside each QR code. Empty means whatever address the
# admin opened the app on. A printed label cannot be changed, so a real
# site's address must be https: farmers' details would otherwise travel
# unencrypted, and phones only save the form offline on https pages.
ARG VITE_PUBLIC_URL=""
ENV VITE_PUBLIC_URL=$VITE_PUBLIC_URL
RUN case "$VITE_PUBLIC_URL" in \
      ""|https://*|http://localhost*|http://127.0.0.1*) ;; \
      *) echo "PUBLIC_URL must start with https:// (got $VITE_PUBLIC_URL)" >&2; exit 1 ;; \
    esac
RUN npm run build


FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/backend
COPY backend/requirements.txt backend/requirements.lock ./
RUN pip install --no-cache-dir -r requirements.txt -c requirements.lock

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
# main.py looks for the built pages in ../frontend/dist.
COPY --from=frontend /frontend/dist /srv/frontend/dist

# The code belongs to root and only runs as this user, so the app cannot
# change itself even if something goes wrong.
RUN useradd --system --no-create-home --uid 10001 seedcode
USER seedcode

EXPOSE 8010
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/api/health', timeout=3)"]

# One process per container: the rate limits and kept answers live in its
# memory (see app/limits.py and app/cache.py). To handle more load, give it
# more CPU before running more copies.
# The database is brought up to date by a separate step that runs once:
#   python -m app.migrate
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010", \
     "--no-server-header", "--timeout-graceful-shutdown", "10", "--limit-concurrency", "200"]
