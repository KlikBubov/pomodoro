# Create all required directories
mkdir -p data/app data/loki data/grafana data/umami-db data/glitchtip-db

# Set ownership for PostgreSQL databases (UID 999 is standard for postgres:15-alpine)
sudo chown -R 999:999 data/umami-db data/glitchtip-db

# Set ownership for Grafana (UID 472)
sudo chown -R 472:472 data/grafana

# Set ownership for Loki (UID 10001)
sudo chown -R 10001:10001 data/loki