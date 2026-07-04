# 🌐 Docker Log Viewer & Streamer

Lekka, szybka i bezpieczna aplikacja webowa służąca do agregacji oraz podglądu logów w czasie rzeczywistym (Real-time Streaming) z Twoich kontenerów Docker (np. schedulerów rsync, rclone) oraz innych usług działających na serwerze (NAS Synology, VPS).

Aplikacja nie obciąża procesora ani pamięci RAM, działając w oparciu o natywne zdarzenia systemowe oraz strumieniowanie danych.

---

## ✨ Główne Funkcje

* **🔐 Bezpieczne logowanie (JWT):** Dostęp zabezpieczony tokenami. Obsługa wbudowanego administratora (`.env`) oraz szyfrowanej bazy użytkowników `bcrypt` (`./config/users.json`).
* **🚫 Kontrola rejestracji:** Możliwość całkowitego zablokowania rejestracji nowych użytkowników za pomocą zmiennej w pliku `.env`.
* **📂 Wielopoziomowy manager logów:** Automatyczne skanowanie struktury katalogów (w tym podfolderów) i renderowanie interaktywnego drzewa plików `.log`.
* **⚡ Strumieniowanie Live (Zero-Polling):** Wykorzystanie technologii Server-Sent Events (SSE) oraz systemowego mechanizmu `inotify` (biblioteka Chokidar). Aplikacja nie odpytuje dysku w pętli – „budzi się” tylko wtedy, gdy inna usługa dopisze nową linię do pliku.
* **🔍 Filtrowanie Client-Side:** Błyskawiczne przeszukiwanie i podświetlanie fraz (np. *ERROR*, *SUCCESS*, *WARN*) bezpośrednio w przeglądarce bez obciążania serwera.
* **🛡️ Ochrona przeglądarki i serwera:** Limit bufora terminala (max 2000 linii) zapobiega zawieszeniu karty przeglądarki, a czytanie pliku strumieniem (`Stream`) chroni pamięć RAM kontenera przed wyczerpaniem przy gigantycznych logach.

---

## 📂 Struktura Katalogów Projektu

```text
log-viewer/
├── config/
│   └── users.json           # Szyfrowana baza danych użytkowników (na start: [])
├── public/
│   ├── index.html           # Ekran logowania i rejestracji
│   └── viewer.html          # Główny panel przeglądarki logów
├── .env                     # Plik konfiguracyjny (port, sekrety, admin, blokada)
├── Dockerfile               # Instrukcja budowania obrazu kontenera
├── docker-compose.yml       # Skrypt uruchomieniowy Docker Compose
├── package.json             # Zależności i skrypty Node.js
└── server.js                # Główny kod backendu (Express + SSE Streamer)

```

---

## 🛠️ Instrukcja Wdrożenia

### 1. Konfiguracja Środowiska (`.env`)

Utwórz plik `.env` w głównym katalogu:

```env
PORT=8020
JWT_SECRET=zmien_mnie_na_super_tajny_i_dlugi_ciag_znakow_2026
ADMIN_USER=admin
ADMIN_PASS=LogiPodKontrola123!
ALLOW_REGISTRATION=true

```

### 2. Konfiguracja Docker Compose (`docker-compose.yml`)

Dostosuj ścieżki po lewej stronie w sekcji `volumes`, wskazując foldery z logami swoich aplikacji. Zwróć uwagę na flagę `:ro` (Read-Only) – gwarantuje ona, że logi są bezpieczne i aplikacja webowa ich nie zmodyfikuje.

```yaml
version: '3.8'

services:
  log-viewer:
    build: .
    container_name: docker-log-viewer
    ports:
      - "${PORT}:${PORT}"
    environment:
      - PORT=${PORT}
      - JWT_SECRET=${JWT_SECRET}
      - ADMIN_USER=${ADMIN_USER}
      - ADMIN_PASS=${ADMIN_PASS}
      - ALLOW_REGISTRATION=${ALLOW_REGISTRATION}
    volumes:
      # Baza użytkowników panelu
      - ./config:/app/config
      
      # MAPOWANIE LOGÓW Z TWOICH INNYCH USŁUG (Zmień lewe ścieżki na własne)
      - /opt/rsync-scheduler/logs:/app/logs/rsync-service:ro
      - /opt/rclone-scheduler/logs:/app/logs/rclone-service:ro
    restart: unless-stopped

```

### 3. Pierwsze Uruchomienie

Uruchom budowanie oraz start kontenera w tle:

```bash
docker compose up -d --build

```

Aplikacja będzie dostępna w przeglądarce pod adresem: `http://IP_TWOJEGO_SERWERA:8020`

---

## 🔒 Dobre Praktyki Bezpieczeństwa

1. **Procedura Rejestracji:** Po uruchomieniu kontenera wejdź na stronę, zarejestruj swoje spersonalizowane konto użytkownika, a następnie natychmiast zmień w pliku `.env` wartość `ALLOW_REGISTRATION=false` i zrestartuj kontener (`docker compose down && docker compose up -d`). Od tej pory nikt postronny nie założy konta.
2. **Izolacja Środowiska (Directory Traversal Protection):** Backend aplikacji posiada wbudowane zabezpieczenie uniemożliwiające manipulację ścieżką URL (np. wstrzykiwanie znaków `../`). Aplikacja ma fizyczny dostęp wyłącznie do zmapowanych podkatalogów wewnątrz `/app/logs`.
