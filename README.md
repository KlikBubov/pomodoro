# Pomodoro Focus Timer - Deployment Guide

This project includes a full observability stack (Grafana Loki, GlitchTip, Umami) alongside the Flask application, all
orchestrated with Docker Compose.

## Prerequisites

- Docker Engine (v20.10+)
- Docker Compose V2 (`docker compose` command)
- OpenSSL (for local SSL generation)

## 1. Initial Setup

Clone the repository and navigate to the project folder:

```bash
git clone https://github.com/KlikBubov/pomodoro.git pomodoro
cd pomodoro
```

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Open `.env` and change all default passwords and secrets. Set `DOMAIN` to your actual domain (e.g., `example.com`) or
leave it as `localhost` for local development.

## 2. SSL Certificates Configuration

### For Local Development (localhost):

Generate self-signed certificates in your system's Let's Encrypt directory to mimic production:

```bash
sudo mkdir -p /etc/letsencrypt/live/localhost
sudo openssl req -x509 -newkey rsa:4096 -keyout /etc/letsencrypt/live/localhost/privkey.pem -out /etc/letsencrypt/live/localhost/fullchain.pem -sha256 -days 365 -nodes -subj "/CN=localhost"
```

### For Production:

Start Nginx temporarily and issue a real Let's Encrypt certificate:

```bash
# Ensure ports 80 and 443 are open on your firewall
docker compose up -d nginx
docker compose run --rm certbot certonly --webroot --webroot-path /var/www/certbot/ -d example.com --email your-email@example.com --agree-tos --no-eff-email
```

## 3. Prepare Data Directories

Create local directories for persistent data and set permissions to avoid Docker permission issues:

```bash
./make_dir.sh
```

## 4. Start the Stack

Build and start all services in the background:

```bash
docker compose up -d --build
```

## 5. Initialize GlitchTip (First Run Only)

GlitchTip requires database migrations and an admin user to be created manually.

Apply database migrations:

```bash
docker compose exec glitchtip python manage.py migrate
```

Create a superuser (follow the prompts):

```bash
docker compose exec glitchtip python manage.py createsuperuser
```

## 6. Post-Installation Setup

### GlitchTip (Error Tracking)

1. Access GlitchTip at `http://<your-ip>:8001` (or your domain if proxied).
2. Log in with the superuser credentials created above.
3. Create a new Project (select Flask as the platform).
4. Copy the DSN URL.
5. Paste the DSN into your `.env` file as `SENTRY_DSN=...`.
6. Restart the Flask app to apply the DSN: `docker compose up -d pomodoro`.

### Umami (Web Analytics)

1. Access Umami at `http://<your-ip>:3000`.
2. Log in with default credentials: `admin` / `umami`. (Change the password immediately in profile settings).
3. Add your website to get the `data-website-id`.
4. Update the Umami script tag in `templates/index.html` with your specific ID.

### Grafana (Log Dashboards)

1. Access Grafana at `http://<your-ip>:3030`.
2. Log in using `GF_SECURITY_ADMIN_USER` and `GF_SECURITY_ADMIN_PASSWORD` from your `.env` file.
3. Navigate to *Connections -> Data Sources -> Add data source -> Loki*.
4. Set the URL to `http://loki:3100` and click *Save & test*.
5. Go to *Explore* to view logs collected from all your Docker containers.

## Useful Commands

- **View logs:** `docker compose logs -f pomodoro`
- **Stop stack:** `docker compose down`
- **Update stack:** `git pull && docker compose up -d --build`