# One image for the whole site: the frontend is built first, then the backend
# serves it together with the API (see the end of backend/app/main.py).

FROM node:24-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# The address printed inside each QR code. Empty means whatever address the
# admin opened the app on.
ARG VITE_PUBLIC_URL=""
ENV VITE_PUBLIC_URL=$VITE_PUBLIC_URL
RUN npm run build


FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
# main.py looks for the built pages in ../frontend/dist.
COPY --from=frontend /frontend/dist /srv/frontend/dist

RUN useradd --system --no-create-home --uid 10001 seedcode
USER seedcode

EXPOSE 8010
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/api/health', timeout=3)"]

# One process per container. To handle more load, run more containers.
# The database is brought up to date by a separate step that runs once:
#   python -m app.migrate
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
