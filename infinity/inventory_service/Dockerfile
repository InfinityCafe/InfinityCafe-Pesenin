FROM python:3.11-slim

# Set environment variable to prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY ./kitchen_service/main.py /app/main.py
COPY ../requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
