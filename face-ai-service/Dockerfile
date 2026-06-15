FROM python:3.9-slim

# Keep Python and pip predictable in containers.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=1000 \
    PIP_RETRIES=10 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    python3-dev \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Use stable PyPI
RUN pip config set global.index-url https://pypi.org/simple \
    && pip config set global.trusted-host pypi.org

# Install packaging tools first, then pinned application requirements.
RUN python -m pip install --upgrade pip setuptools wheel \
    && pip install --prefer-binary -r requirements.txt

# Copy application code
COPY . .

# Create non-root user and writable runtime directories
RUN useradd -m -u 1000 -s /bin/bash appuser \
    && mkdir -p /app/models /app/logs \
    && chown -R appuser:appuser /app /app/models /app/logs
ENV PATH="/home/appuser/.local/bin:$PATH"
USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Start application — use main.py which has real ML pipeline (app.py is mock-only)
CMD ["python", "src/main.py"]
