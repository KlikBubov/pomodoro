# 1. Легкий образ Python
FROM python:3.11-slim

# 2. Переменные окружения
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# 3. Установка зависимостей
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Копирование кода
COPY . .

# 5. ВАЖНО: Сначала создаем пользователя, потом папку и выдаем права!
RUN useradd -m appuser
RUN mkdir -p /app/data
RUN chown -R appuser:appuser /app

# Переключаемся на безопасного пользователя
USER appuser

EXPOSE 8000

# 6. Запуск через Gunicorn
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:8000", "--access-logfile", "-", "--error-logfile", "-", "app:app"]