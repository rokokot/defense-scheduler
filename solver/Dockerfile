# Solver Dockerfile for Defense Scheduler
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy solver source code
COPY src/ ./src/
COPY setup.py .

# Install solver as package
RUN pip install -e .

# Create data directory
RUN mkdir -p /app/data

EXPOSE 8001

# Default command (can be overridden)
CMD ["python", "-c", "print('Solver container ready. Use as service or run specific scripts.')"]
