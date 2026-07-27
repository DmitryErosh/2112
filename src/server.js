const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Раздача статических файлов
app.use(express.static(path.join(__dirname, '../public')));

// Хранилище комнат и сообщений в памяти
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Вход в комнату
    socket.on('joinRoom', ({ username, roomCode }) => {
        const room = roomCode.toUpperCase();
        
        if (!rooms[room]) {
            rooms[room] = { users: [], messages: [] };
        }

        socket.join(room);
        rooms[room].users.push({ id: socket.id, username });

        // Отправляем пользователю историю сообщений
        socket.emit('messageHistory', rooms[room].messages);
        
        // Сообщаем другим, что кто-то зашел
        socket.to(room).emit('systemMessage', `${username} присоединился к комнате`);
        
        // Обновляем список пользователей в комнате
        io.to(room).emit('updateUsers', rooms[room].users);
        
        console.log(`User ${username} joined room ${room}`);
    });

    // Обработка сообщений
    socket.on('chatMessage', (msg) => {
        const user = rooms[Object.keys(rooms).find(key => 
            rooms[key].users.find(u => u.id === socket.id)
        )]?.users.find(u => u.id === socket.id);

        if (user) {
            const messageData = {
                username: user.username,
                text: msg.text,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isCode: msg.isCode || false
            };

            const roomCode = Object.keys(rooms).find(key => 
                rooms[key].users.find(u => u.id === socket.id)
            );

            if (roomCode) {
                rooms[roomCode].messages.push(messageData);
                // Ограничим историю 50 сообщениями
                if (rooms[roomCode].messages.length > 50) {
                    rooms[roomCode].messages.shift();
                }
                io.to(roomCode).emit('chatMessage', messageData);
            }
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
