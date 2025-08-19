# Multi-stage build for frontend and server
FROM node:18 AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

FROM python:3.10 AS server
WORKDIR /app/server
COPY server/requirements.txt ./
RUN pip install -r requirements.txt
COPY server/ .

FROM python:3.10
WORKDIR /app
COPY --from=frontend /app/frontend/dist ./frontend/dist
COPY --from=server /app/server ./
EXPOSE 3000 8000
CMD ["bash", "start.sh"]