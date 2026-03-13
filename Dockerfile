# Stage 1: Build frontend
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY backend/frontend/package*.json ./
RUN npm ci
COPY backend/frontend/ ./
RUN npm run build

# Stage 2: Python backend
FROM python:3.12-slim
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/main.py .

# Copy built frontend assets from stage 1
COPY --from=frontend /app/index.html ./index.html
COPY --from=frontend /app/assets/ ./assets/

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
