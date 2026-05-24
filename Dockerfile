# Dockerfile  –  Oxford 3000 Vocabulary Trainer
# Used by Fly.io to build and run the Flask application.

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install Python dependencies first (cached layer — only rebuilds when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Create the data directory; on Fly.io this will be replaced by the persistent volume
RUN mkdir -p /data

# Expose the port Gunicorn will listen on
EXPOSE 8000

# Start Gunicorn in production mode
# Shell form is used here so the single quotes inside the app reference work correctly
CMD gunicorn "app:create_app('production')" \
    --workers 1 \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
