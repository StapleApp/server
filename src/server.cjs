// mesajlaşma için server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Allowed origins can be overridden with the ALLOWED_ORIGINS env var
// (comma-separated) so you don't have to redeploy to change them.
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [
        "https://web.stapleapp.com",
        "https://socket.stapleapp.com"
    ];

const io = new Server(server, {
    path: "/socket.io",
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // ==================== WebRTC SESLİ KANAL SIGNALING ====================
    // Sesli kanala katıl: odadaki mevcut peer'ları yeni gelene bildir,
    // diğerlerine de yeni peer'ı haber ver.
    socket.on('voice:join', ({ roomId, userId, nickName }) => {
        socket.data.voiceRoom = roomId;
        socket.data.userId = userId;
        socket.data.nickName = nickName;
        socket.join(roomId);

        const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
            .filter((id) => id !== socket.id);

        const peers = clients.map((id) => {
            const s = io.sockets.sockets.get(id);
            return { socketId: id, userId: s?.data?.userId, nickName: s?.data?.nickName };
        });

        // Yeni gelene mevcut peer listesini gönder (o initiator olacak)
        socket.emit('voice:peers', peers);
        // Diğerlerine yeni katılanı bildir
        socket.to(roomId).emit('voice:peer-joined', {
            socketId: socket.id,
            userId,
            nickName,
        });
        console.log(`voice:join ${nickName} -> ${roomId} (${peers.length} peer)`);
    });

    // Signaling mesajlarını hedef peer'a ilet
    socket.on('voice:offer', ({ to, sdp }) => {
        io.to(to).emit('voice:offer', {
            from: socket.id,
            sdp,
            userId: socket.data.userId,
            nickName: socket.data.nickName,
        });
    });

    socket.on('voice:answer', ({ to, sdp }) => {
        io.to(to).emit('voice:answer', { from: socket.id, sdp });
    });

    socket.on('voice:ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('voice:ice-candidate', { from: socket.id, candidate });
    });

    // Sesli kanaldan ayrıl
    socket.on('voice:leave', () => {
        const roomId = socket.data.voiceRoom;
        if (roomId) {
            socket.to(roomId).emit('voice:peer-left', { socketId: socket.id });
            socket.leave(roomId);
            socket.data.voiceRoom = null;
        }
    });
    // =====================================================================

    // Kullanıcı bağlantısı kesildiğinde
    socket.on('disconnect', () => {
        console.log('Bir kullanıcı ayrıldı:', socket.id);

        // Sesli kanaldaki peer'lara ayrıldığını bildir
        if (socket.data.voiceRoom) {
            socket.to(socket.data.voiceRoom).emit('voice:peer-left', { socketId: socket.id });
        }
    });
});

server.on('error', (error) => {
    console.error('Sunucu hatası:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Yakalanmamış istisna:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('İşlenmeyen reddetme:', reason);
});

// Hosting platforms (Render, Fly, etc.) inject the port via process.env.PORT.
// Fall back to 3000 for local development.
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor ve tüm ağ arayüzlerinden erişilebilir`);
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});