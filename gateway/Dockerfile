
FROM python:3.12

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY gateway/gateway.py ./gateway.py

CMD ["uvicorn", "gateway:app", "--host", "0.0.0.0", "--port", "2323"]
