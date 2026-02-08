# Backend Dockerfile for Defense Scheduler
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for CPMpy solvers and health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy and install solver package first (keep sources for runtime imports)
COPY solver ./solver
RUN pip install --no-cache-dir ./solver

# Copy requirements and install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ .

# Copy Defense-rostering driver pipeline
COPY Defense-rostering ./Defense-rostering

# Create data directories
RUN mkdir -p data/input data/output data/snapshots Defense-rostering/input_data Defense-rostering/output_data

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
