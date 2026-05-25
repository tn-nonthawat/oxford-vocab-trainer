# Dockerfile  –  Oxford 3000 Vocabulary Trainer (multi-stage)
#
# Stage 1  (frontend-builder) : Node 20 builds the Vite/React bundle.
# Stage 2  (runtime)          : Python 3.11 runs Flask + Gunicorn.
# The compiled JS/CSS is copied from Stage 1 into Flask's static folder,
# so only the Python image is shipped — no Node runtime in production.

# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Install dependencies first (cached layer — only rebuilds when package.json changes)
COPY dashboard-react/package*.json ./
RUN npm ci

# Copy source and build
COPY dashboard-react/ ./
RUN npm run build
# Vite output is at /frontend/dist/

# ── Stage 2: Flask + Gunicorn runtime ─────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source (node_modules excluded via .dockerignore)
COPY . .

# Copy the compiled React bundle into Flask's static folder
COPY --from=frontend-builder /frontend/dist ./static/react

# Create the data directory; on Fly.io this is replaced by the persistent volume
RUN mkdir -p /data

# Expose the port Gunicorn will listen on
EXPOSE 8000

# Start Gunicorn in production mode
CMD gunicorn "app:create_app('production')" \
    --workers 1 \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
