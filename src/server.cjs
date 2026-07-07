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
  
// Kullanıcı sayısını takip etmek için
let userCount = 0;
// Kullanıcıları ve odalarını takip etmek için
const activeUsers = new Map(); // socketId -> {userId, rooms}
const userRooms = new Map(); // roomId -> Set of socketIds

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);
    userCount++;
    io.emit('userCount', userCount);

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

    // Kullanıcı odaya katılıyor
    socket.on('joinRoom', ({ roomId, userId }) => {
        console.log(`Kullanıcı ${socket.id} (${userId}) odaya katıldı: ${roomId}`);
        
        // Socket'i odaya ekle
        socket.join(roomId);
        
        // Kullanıcı bilgilerini kaydet
        if (!activeUsers.has(socket.id)) {
            activeUsers.set(socket.id, { userId, rooms: new Set() });
        }
        activeUsers.get(socket.id).rooms.add(roomId);
        
        // Oda bilgilerini güncelle
        if (!userRooms.has(roomId)) {
            userRooms.set(roomId, new Set());
        }
        userRooms.get(roomId).add(socket.id);
        
        // Odadaki kullanıcı sayısını bildir
        const roomSize = userRooms.get(roomId).size;
        io.to(roomId).emit('roomUserCount', { roomId, count: roomSize });
    });
    
    // Kullanıcı odadan ayrılıyor
    socket.on('leaveRoom', ({ roomId }) => {
        console.log(`Kullanıcı ${socket.id} odadan ayrıldı: ${roomId}`);
        leaveRoom(socket, roomId);
    });
    
    // Özel mesaj gönderme
    socket.on('sendPrivateMessage', (data, callback) => {
    const { roomId } = data;
    console.log(`Özel mesaj alındı (Oda: ${roomId}):`, data.message);
    console.log('Alıcılara iletiliyor, oda üyeleri:', userRooms.get(roomId)?.size || 0);
    
    // Mesajı sadece ilgili odadaki kullanıcılara gönder
    socket.to(roomId).emit('receiveMessage', data);
    
    if (callback) callback({ success: true });
    });
    
    // Eski genel mesajlar için - geriye dönük uyumluluk
    socket.on('sendMessage', (message, callback) => {
        console.log('Genel mesaj alındı:', message);
        io.emit('receiveMessage', message);
        if (callback) callback({ success: true });
    });
    
    // Kullanıcı yazıyor bildirimi
    socket.on('userTyping', (data) => {
        console.log('Yazma durumu alındı:', data);
        
        // Özel oda için yazma durumu
        if (data.roomId) {
            socket.to(data.roomId).emit('userTyping', data);
        } else {
            // Geriye dönük uyumluluk için
            socket.broadcast.emit('userTyping', data);
        }
    });
    
    // Kullanıcı bağlantısı kesildiğinde
    socket.on('disconnect', () => {
        console.log('Bir kullanıcı ayrıldı:', socket.id);
        userCount--;
        io.emit('userCount', userCount);

        // Sesli kanaldaki peer'lara ayrıldığını bildir
        if (socket.data.voiceRoom) {
            socket.to(socket.data.voiceRoom).emit('voice:peer-left', { socketId: socket.id });
        }

        // Kullanıcıyı tüm odalardan çıkar
        if (activeUsers.has(socket.id)) {
            const userInfo = activeUsers.get(socket.id);
            for (const roomId of userInfo.rooms) {
                leaveRoom(socket, roomId);
            }
            activeUsers.delete(socket.id);
        }
    });
    
    // Kullanıcı çevrimiçi durumunu bildir
    socket.on('userOnlineStatus', ({ userId, status }) => {
        console.log(`Kullanıcı ${userId} durumu: ${status}`);
        io.emit('userStatusUpdate', { userId, status });
    });
});

// Kullanıcının odadan çıkması için yardımcı fonksiyon
function leaveRoom(socket, roomId) {
    socket.leave(roomId);
    
    // Kullanıcı bilgilerini güncelle
    if (activeUsers.has(socket.id)) {
        activeUsers.get(socket.id).rooms.delete(roomId);
    }
    
    // Oda bilgilerini güncelle
    if (userRooms.has(roomId)) {
        userRooms.get(roomId).delete(socket.id);
        
        // Odadaki kullanıcı sayısını bildir
        const roomSize = userRooms.get(roomId).size;
        io.to(roomId).emit('roomUserCount', { roomId, count: roomSize });
        
        // Eğer odada hiç kullanıcı kalmadıysa, odayı temizle
        if (roomSize === 0) {
            userRooms.delete(roomId);
        }
    }
}

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