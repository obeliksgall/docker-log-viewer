FROM node:20.18-alpine

# Instalacja narzędzi niezbędnych do kompilacji bcrypt na alpine
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

# Wyciszenie ostrzeżeń o przestarzałych pakietach i powiadomień o nowej wersji npm
ENV NPM_CONFIG_LOGLEVEL=error
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Instalacja produkcyjna
RUN npm install --omit=dev --allow-scripts

COPY . .

# Tworzymy domyślny katalog na logi oraz konfigurację
RUN mkdir -p /app/logs /app/config

EXPOSE 8020

CMD ["npm", "start"]