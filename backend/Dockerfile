FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLANT_DISEASE_HOST=0.0.0.0 \
    PLANT_DISEASE_PORT=8000 \
    PLANT_DISEASE_ENABLE_SCAN_HISTORY=false

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY class_labels.py disease_info.py main.py model_utils.py scan_history.py ./
COPY model/efficientnetv2_plant_model.h5 ./model/efficientnetv2_plant_model.h5

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data \
    && chown appuser:appuser /data

USER appuser
EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn main:app --host \"${PLANT_DISEASE_HOST}\" --port \"${PLANT_DISEASE_PORT}\""]
