FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY app.js /usr/share/nginx/html/app.js
COPY favicon.png /usr/share/nginx/html/favicon.png
COPY logo.png /usr/share/nginx/html/logo.png
COPY plugins/ /usr/share/nginx/html/plugins/

EXPOSE 80
