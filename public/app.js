const socket = io();
let currentRoom = null;
let myUsername = null;
let isCodeMode = false;

// Элементы
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username');
const roomCodeInput = document.getElementById('room-code');
const displayRoomCode = document.getElementById('display-room-code');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const codeModeBtn = document.getElementById('code-mode-btn');
const fileInput = document.getElementById('file-input');

// Создание комнаты
function createRoom() {
    const username = usernameInput.value.trim();
    if (!username) return alert('Введите имя!');
    
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    enterChat(username, code);
}

// Вход в комнату
function joinRoom() {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();
    
    if (!username) return alert('Введите имя!');
    if (!code) return alert('Введите код комнаты!');
    
    enterChat(username, code);
}

function enterChat(username, code) {
    myUsername = username;
    currentRoom = code;
    
    loginScreen.classList.remove('active');
    chatScreen.classList.add('active');
    displayRoomCode.textContent = code;
    
    socket.emit('joinRoom', { username, roomCode: code });
    
    // Фокус на поле ввода для мобильных
    setTimeout(() => {
        messageInput.focus();
    }, 300);
}

// Отправка сообщения
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    
    socket.emit('chatMessage', { text, isCode: isCodeMode });
    messageInput.value = '';
    messageInput.style.height = 'auto';
}

// Обработка выбора файла
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            return alert(error.error || 'Ошибка загрузки файла');
        }
        
        const data = await response.json();
        
        // Отправляем сообщение с файлом
        socket.emit('chatMessage', {
            text: '',
            isCode: false,
            type: data.type,
            fileUrl: data.url
        });
        
        // Очищаем input
        fileInput.value = '';
    } catch (err) {
        console.error('Upload error:', err);
        alert('Ошибка загрузки файла');
    }
}

// Очистка чата
function clearChat() {
    if (!confirm('Вы уверены, что хотите очистить весь чат?')) return;
    socket.emit('clearChat', currentRoom);
}

// Переключение режима кода
function toggleCodeMode() {
    isCodeMode = !isCodeMode;
    codeModeBtn.classList.toggle('active');
    messageInput.placeholder = isCodeMode ? 'Вставьте код здесь...' : 'Сообщение...';
    messageInput.focus();
}

// Копирование кода комнаты
function copyCode() {
    navigator.clipboard.writeText(currentRoom);
    alert('Код скопирован: ' + currentRoom);
}

// Выход
function leaveRoom() {
    location.reload();
}

// Обработка входящих сообщений
socket.on('chatMessage', (msg) => {
    renderMessage(msg);
    scrollToBottom();
});

socket.on('messageHistory', (history) => {
    messagesDiv.innerHTML = '';
    history.forEach(msg => renderMessage(msg));
    scrollToBottom();
});

socket.on('chatCleared', () => {
    messagesDiv.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = 'Чат очищен';
    messagesDiv.appendChild(div);
});

socket.on('systemMessage', (text) => {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = text;
    messagesDiv.appendChild(div);
    scrollToBottom();
});

socket.on('updateUsers', (users) => {
    // Можно добавить отображение списка пользователей, если нужно
    console.log('Users in room:', users);
});

function renderMessage(msg) {
    const div = document.createElement('div');
    const isMy = msg.username === myUsername;
    div.className = `message ${isMy ? 'my' : 'other'}`;
    
    let content = `<div class="msg-header"><span>${msg.username}</span><span>${msg.time}</span></div>`;
    
    if (msg.type === 'image') {
        content += `<div class="msg-text"><img src="${msg.fileUrl}" alt="Image" class="message-image"></div>`;
    } else if (msg.type === 'audio') {
        content += `<div class="msg-text"><audio controls src="${msg.fileUrl}" class="message-audio"></audio></div>`;
    } else if (msg.isCode) {
        content += `<div class="msg-text"><pre class="code-block">${escapeHtml(msg.text)}</pre></div>`;
    } else {
        content += `<div class="msg-text">${escapeHtml(msg.text)}</div>`;
    }
    
    div.innerHTML = content;
    messagesDiv.appendChild(div);
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scrollToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Авто-увеличение поля ввода
messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
