docker run -d \
  --name mysql-db \
  -p 3306:3306 \
  -v mysql_data:/var/lib/mysql \
  -e MYSQL_ROOT_PASSWORD=admin \
  -e MYSQL_DATABASE=app_db \
  -e MYSQL_USER=mpreto \
  -e MYSQL_PASSWORD=1234 \
  mysql:8.0
