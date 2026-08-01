FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --create-home --uid 10001 hairtwin
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
COPY scripts/download_cv_models.py ./scripts/download_cv_models.py
ENV HAIR_TWIN_CV_MODEL_DIR=/app/models
RUN python ./scripts/download_cv_models.py && chown -R hairtwin:hairtwin /app/models
COPY --chown=hairtwin:hairtwin app ./app
USER hairtwin

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT',os.environ.get('HAIR_TWIN_HEALTH_PORT','8080'))+'/healthz',timeout=3)"]
CMD ["python", "-m", "app.main"]
