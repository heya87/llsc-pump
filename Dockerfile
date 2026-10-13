# llsc-pump — static web app, served by nginx. Coolify builds this on push.
# Login is not handled here: Traefik checks every request against hub-auth first.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css logo.png *.js /usr/share/nginx/html/
EXPOSE 80
