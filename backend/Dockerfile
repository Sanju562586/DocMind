FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed for PyMuPDF / OpenCV / PDF parsing
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install CPU-optimized PyTorch & Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# Copy application files
COPY . .

# Ensure data directories exist
RUN mkdir -p data/uploads data/indexes

# Expose server port
EXPOSE 8000

# Start Uvicorn FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
