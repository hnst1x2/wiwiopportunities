FROM node:22-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --only=production

COPY server ./server
COPY public ./public
COPY views ./views

EXPOSE 3000

CMD ["node", "server/app.js"]
