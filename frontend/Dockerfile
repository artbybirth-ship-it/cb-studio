FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache unzip
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
