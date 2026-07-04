const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const chokidar = require('chokidar');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const PORT = process.env.PORT || 8020;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_2026';
const USERS_FILE = path.join(__dirname, 'config', 'users.json');
const LOGS_DIR = path.join(__dirname, 'logs');

// Upewnij się, że katalog na logi istnieje
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// --- MIDDLEWARE AUTORYZACJI ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Brak tokenu autoryzacji' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token nieaktywny lub wygasł' });
        req.user = user;
        next();
    });
};

// --- BEZPIECZEŃSTWO: ZABEZPIECZENIE PRZED DIRECTORY TRAVERSAL ---
const safeResolvePath = (reqPath) => {
    const targetPath = path.resolve(LOGS_DIR, reqPath);
    if (!targetPath.startsWith(LOGS_DIR)) {
        throw new Error('Próba nieautoryzowanego dostępu poza katalog logów');
    }
    return targetPath;
};

// --- ENDPOINTY AUTORYZACJI ---

// Logowanie (Admin z .env lub użytkownik z users.json)
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    // 1. Sprawdzenie konta Admina z .env
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
        return res.json({ token, username });
    }

    // 2. Sprawdzenie użytkowników z pliku
    try {
        const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
        const user = users.find(u => u.username === username);

        if (user && await bcrypt.compare(password, user.password)) {
            const token = jwt.sign({ username, role: 'user' }, JWT_SECRET, { expiresIn: '8h' });
            return res.json({ token, username });
        }
    } catch (e) {
        console.error("Błąd odczytu bazy użytkowników", e);
    }

    res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
});

// Rejestracja nowego użytkownika
app.post('/api/auth/register', async (req, res) => {
    if (process.env.ALLOW_REGISTRATION !== 'true') {
        return res.status(403).json({ error: 'Rejestracja jest obecnie zablokowana' });
    }

    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Uzupełnij wszystkie pola' });

    try {
        const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
        if (users.some(u => u.username === username) || username === process.env.ADMIN_USER) {
            return res.status(400).json({ error: 'Użytkownik o takiej nazwie już istnieje' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, password: hashedPassword });
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

        res.status(201).json({ message: 'Rejestracja pomyślna' });
    } catch (e) {
        res.status(500).json({ error: 'Błąd serwera podczas rejestracji' });
    }
});

// Pobranie statusu rejestracji (dla frontendu, aby ukryć/pokazać przycisk)
app.get('/api/auth/config', (req, res) => {
    res.json({ allowRegistration: process.env.ALLOW_REGISTRATION === 'true' });
});

// --- ENDPOINTY ZARZĄDZANIA PLIKAMI LOGÓW ---

// Pobieranie drzewa plików logów
app.get('/api/logs/tree', authenticateToken, (req, res) => {
    const getFilesTree = (dirPath, relativePath = '') => {
        const results = [];
        const list = fs.readdirSync(dirPath);

        list.forEach(file => {
            const fullPath = path.join(dirPath, file);
            const relPath = path.join(relativePath, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                results.push({
                    name: file,
                    type: 'directory',
                    path: relPath,
                    children: getFilesTree(fullPath, relPath)
                });
            } else if (file.endsWith('.log')) {
                results.push({
                    name: file,
                    type: 'file',
                    path: relPath,
                    size: stat.size
                });
            }
        });

        // Sortowanie: katalogi na górę, pliki alfabetycznie
        return results.sort((a, b) => (b.type === 'directory') - (a.type === 'directory') || a.name.localeCompare(b.name));
    };

    try {
        const tree = getFilesTree(LOGS_DIR);
        res.json(tree);
    } catch (e) {
        res.status(500).json({ error: 'Nie udało się zeskanować katalogu logów' });
    }
});

// --- STRUMIENIOWANIE LOGÓW LIVE ZA POMOCĄ SSE (SERVER-SENT EVENTS) ---
app.get('/api/logs/stream', (req, res) => {
    // Weryfikacja tokenu przekazanego w Query String (SSE nie obsługuje łatwo nagłówków HTTP w natywnym EventSource)
    const token = req.query.token;
    if (!token) return res.status(401).write('Unauthorized');

    try {
        jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return res.status(403).write('Forbidden');
    }

    const logFilePath = req.query.path;
    if (!logFilePath) return res.status(400).json({ error: 'Brak ścieżki do pliku' });

    let fullLogPath;
    try {
        fullLogPath = safeResolvePath(logFilePath);
        if (!fs.existsSync(fullLogPath) || !fs.statSync(fullLogPath).isFile()) {
            return res.status(404).json({ error: 'Plik nie istnieje' });
        }
    } catch (e) {
        return res.status(403).json({ error: e.message });
    }

    // Ustawienie nagłówków HTTP dla Server-Sent Events
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // KROK 1: Wyślij na start końcówkę obecnego pliku (ostatnie 150 linii) - Oszczędność RAM
    const fileBuffer = fs.readFileSync(fullLogPath, 'utf8');
    const lines = fileBuffer.split('\n');
    const lastLines = lines.slice(-150);
    
    res.write(`data: ${JSON.stringify({ type: 'init', lines: lastLines })}\n\n`);

    // KROK 2: Uruchom wydajny watcher (Chokidar), który czeka na dopisanie nowych linii przez inotify
    let fileSize = fs.statSync(fullLogPath).size;

    const watcher = chokidar.watch(fullLogPath, { persistent: true, usePolling: false });

    watcher.on('change', () => {
        try {
            const stats = fs.statSync(fullLogPath);
            if (stats.size > fileSize) {
                // Czytamy tylko ten fragment pliku, który został dopisany od ostatniego sprawdzenia
                const stream = fs.createReadStream(fullLogPath, {
                    start: fileSize,
                    end: stats.size
                });

                stream.on('data', (chunk) => {
                    const newLines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                    if (newLines.length > 0) {
                        res.write(`data: ${JSON.stringify({ type: 'update', lines: newLines })}\n\n`);
                    }
                });

                fileSize = stats.size;
            } else if (stats.size < fileSize) {
                // Jeśli log został wyczyszczony / nadpisany od nowa
                fileSize = stats.size;
                res.write(`data: ${JSON.stringify({ type: 'clear', lines: [] })}\n\n`);
            }
        } catch (err) {
            console.error("Błąd podczas odczytu zmian w logu", err);
        }
    });

    // Zamknięcie połączenia przez użytkownika (np. opuszczenie strony)
    req.on('close', () => {
        watcher.close();
        res.end();
    });
});

// Start serwera
app.listen(PORT, () => {
    console.log(`🚀 Docker Log Viewer działa na porcie ${PORT}`);
    console.log(`📂 Ścieżka monitorowania logów: ${LOGS_DIR}`);
});