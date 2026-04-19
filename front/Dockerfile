FROM php:8.5.2-fpm-alpine AS base

RUN apk add --no-cache \
    nginx \
    git \
    bash \
    multirun

COPY --from=composer:latest /usr/bin/composer /usr/local/bin/composer

WORKDIR /app

COPY ./nginx.conf /etc/nginx/http.d/default.conf

COPY . /app

RUN composer install

CMD ["multirun", "php-fpm -R -F", "nginx -g 'daemon off;'"]
