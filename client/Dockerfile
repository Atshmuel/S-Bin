FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ARG VITE_API_URL
ARG VITE_LANDING_HOST
ARG VITE_APP_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_LANDING_HOST=$VITE_LANDING_HOST
ENV VITE_APP_URL=$VITE_APP_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]