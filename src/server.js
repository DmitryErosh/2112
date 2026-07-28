const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coderoom';

// Создаем директорию для загрузки файлов
const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB лимит
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|mp3|wav|ogg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения и аудио файлы'));
        }
    }
});

// Раздача статических файлов
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(uploadsDir));

// Эндпоинт для загрузки файлов
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    res.json({ 
        url: `/uploads/${req.file.filename}`,
        type: req.file.mimetype.startsWith('image/') ? 'image' : 'audio',
        filename: req.file.filename
    });
});

// Подключение к MongoDB
let dbConnected = false;
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('MongoDB connected');
        dbConnected = true;
    })
    .catch(err => {
        console.log('MongoDB connection error:', err.message);
        console.log('Working without database - messages will not be saved permanently');
    });

// Схема сообщения
const messageSchema = new mongoose.Schema({
    roomCode: String,
    username: String,
    text: String,
    time: String,
    isCode: Boolean,
    type: { type: String, default: 'text' }, // text, image, audio
    fileUrl: String,
    createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// Хранилище комнат в памяти (для активных пользователей)
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Вход в комнату
    socket.on('joinRoom', async ({ username, roomCode }) => {
        const room = roomCode.toUpperCase();
        
        if (!rooms[room]) {
            rooms[room] = { users: [], messages: [] };
        }

        socket.join(room);
        rooms[room].users.push({ id: socket.id, username });

        // Загружаем историю сообщений из базы данных
        let messages = [];
        if (dbConnected) {
            try {
                messages = await Message.find({ roomCode: room })
                    .sort({ createdAt: 1 })
                    .limit(50);
            } catch (err) {
                console.error('Error loading messages:', err);
            }
        }
        
        socket.emit('messageHistory', messages);
        
        // Сообщаем другим, что кто-то зашел
        socket.to(room).emit('systemMessage', `${username} присоединился к комнате`);
        
        // Обновляем список пользователей в комнате
        io.to(room).emit('updateUsers', rooms[room].users);
        
        console.log(`User ${username} joined room ${room}`);
    });

    // Обработка текстовых сообщений
    socket.on('chatMessage', async (msg) => {
        const user = rooms[Object.keys(rooms).find(key => 
            rooms[key].users.find(u => u.id === socket.id)
        )]?.users.find(u => u.id === socket.id);

        if (user) {
            const messageData = {
                roomCode: Object.keys(rooms).find(key => 
                    rooms[key].users.find(u => u.id === socket.id)
                ),
                username: user.username,
                text: msg.text,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isCode: msg.isCode || false,
                type: 'text'
            };

            // Сохраняем в базу данных
            if (dbConnected) {
                try {
                    await Message.create(messageData);
                } catch (err) {
                    console.error('Error saving message:', err);
                }
            }

            if (messageData.roomCode) {
                io.to(messageData.roomCode).emit('chatMessage', messageData);
            }
        }
    });

    // Очистка чата
    socket.on('clearChat', async (roomCode) => {
        const room = roomCode.toUpperCase();
        const user = rooms[room]?.users.find(u => u.id === socket.id);
        
        if (user && rooms[room]) {
            // Удаляем сообщения из базы данных
            if (dbConnected) {
                try {
                    await Message.deleteMany({ roomCode: room });
                } catch (err) {
                    console.error('Error clearing messages:', err);
                }
            }
            
            // Очищаем в памяти
            rooms[room].messages = [];
            
            // Сообщаем всем в комнате
            io.to(room).emit('chatCleared');
        }
    });

    // Отключение
    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const userIndex = rooms[roomCode].users.findIndex(u => u.id === socket.id);
            if (userIndex !== -1) {
                const username = rooms[roomCode].users[userIndex].username;
                rooms[roomCode].users.splice(userIndex, 1);
                io.to(roomCode).emit('systemMessage', `${username} покинул комнату`);
                io.to(roomCode).emit('updateUsers', rooms[roomCode].users);
                
                if (rooms[roomCode].users.length === 0) {
                    delete rooms[roomCode];
                }
                break;
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
