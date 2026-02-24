FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./proxy/src
COPY logging_config.json ./logging_config.json

CMD ["uvicorn", "proxy.src.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-config", "./logging_config.json"]
