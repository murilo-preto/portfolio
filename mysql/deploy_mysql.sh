#!/bin/bash

# Stop and remove existing container if it exists
echo "Cleaning up existing MySQL container..."
docker stop mysql-db 2>/dev/null || true
docker rm mysql-db 2>/dev/null || true

# Remove old volume to ensure clean state
echo "Removing old volume..."
docker volume rm mysql_data 2>/dev/null || true

# Create new volume
echo "Creating new volume..."
docker volume create mysql_data

# Start MySQL container
echo "Starting MySQL container..."
docker run -d \
  --name mysql-db \
  --network namu \
  -v mysql_data:/var/lib/mysql \
  -e MYSQL_ROOT_PASSWORD=admin \
  mysql:8.0

# Wait for MySQL to be ready
echo "Waiting for MySQL to be ready..."
for i in {1..30}; do
  if docker exec mysql-db mysqladmin ping -h mysql-db -uroot -padmin --silent 2>/dev/null; then
    echo "MySQL is ready!"
    break
  fi
  echo "Waiting... ($i/30)"
  sleep 2
done

# Apply schema
echo "Applying schema..."
docker exec -i mysql-db mysql -uroot -padmin < schema.sql

# Create application user and grant privileges
echo "Creating application user..."
docker exec -i mysql-db mysql -uroot -padmin <<EOF
CREATE USER IF NOT EXISTS 'username'@'%' IDENTIFIED BY '1234';
GRANT ALL PRIVILEGES ON time_tracker.* TO 'username'@'%';
FLUSH PRIVILEGES;
EOF

echo "✓ Deployment complete!"
echo ""
echo "Connection details:"
echo "  Host: mysql-db"
echo "  Port: 3306"
echo "  Database: time_tracker"
echo "  User: username"
echo "  Password: 1234"
echo "  Root password: admin"
