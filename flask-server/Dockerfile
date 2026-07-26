FROM python:3.12

ENV FLASK_RUN_PORT=3000
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# poppler-utils provides pdftotext, used to read Itau statement PDFs
RUN apt-get update && apt-get install -y --no-install-recommends curl poppler-utils && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 3000

CMD ["gunicorn", "--bind", "0.0.0.0:3000", "--workers", "4", "--threads", "2", "app:app"]
