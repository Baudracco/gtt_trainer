FROM php:8.3-fpm-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libonig-dev libxml2-dev unzip python3 ca-certificates \
    && docker-php-ext-install pdo_pgsql mbstring dom \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /var/www/server
COPY server/composer.json server/composer.lock ./
RUN composer install --no-dev --no-scripts --no-interaction --prefer-dist
COPY server/ ./
COPY data/ /var/www/data/
COPY tools/ /var/www/tools/
RUN mkdir -p /var/www/server/var && chown www-data:www-data /var/www/server/var
RUN printf '[www]\nclear_env = no\n' > /usr/local/etc/php-fpm.d/zz-gtt.conf
CMD ["sh", "-c", "php bin/console.php migrate && exec php-fpm"]
