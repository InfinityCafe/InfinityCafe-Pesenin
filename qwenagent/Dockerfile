FROM python:3.13
WORKDIR /app
COPY ./main.py /app/main.py
COPY ./requirements.txt /app/requirements.txt
# RUN pip install --no-cache-dir -r /app/requirements.txt
# RUN pip install -r /app/requirements.txt
# CMD ["uvicorn", "main", "--host", "0.0.0.0", "--port", "7861", "--log-level", "debug"]
RUN apt-get update && apt-get install -y build-essential curl \
    && pip install --upgrade pip \
    && pip install -r requirements.txt \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

EXPOSE 7860 9000

CMD ["python","main.py"]