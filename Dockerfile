# llsc-pump — static files + per-user JSON API (server.js, no dependencies). Coolify builds this on push.
# Login is not handled here: Traefik checks every request against hub-auth first and sets X-Auth-User.
FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY index.html style.css logo.png *.js ./public/
RUN rm ./public/server.js
ENV PORT=80 DATA_DIR=/app/data STATIC_DIR=/app/public
EXPOSE 80
CMD ["node", "server.js"]
