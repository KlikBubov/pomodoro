# 1. Use a lightweight, secure Python base image
FROM python:3.11-slim

# 2. Set environment variables to prevent Python from writing .pyc files
# and to ensure output is sent straight to the terminal without buffering.
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 3. Set the working directory inside the container
WORKDIR /app

# 4. Copy only the requirements file first (for efficient caching)
COPY requirements.txt .

# 5. Install dependencies (no cache keeps the image small)
RUN pip install --no-cache-dir -r requirements.txt

# 6. Copy the rest of the application code
COPY . .

# 7. SECURITY: Create a non-root user and switch to it
# Running as root inside a container is a major security risk
RUN useradd -m appuser
USER appuser

# 8. Expose the port Gunicorn will run on
EXPOSE 8000

# 9. Run the app using Gunicorn (bypasses app.run() and debug mode completely)
# -w 4: 4 worker processes
# -b 0.0.0.0:8000: bind to all interfaces on port 8000
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:8000", "--access-logfile", "-", "--error-logfile", "-", "app:app"]