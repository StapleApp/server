// mesajlaşma için server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    path: "/socket.io", 
    cors: {
      origin: [
        "https://web.stapleapp.com",
        "https://socket.stapleapp.com"
      ],
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

// PORT 3000 üzerinden dinliyor
server.listen(3000, '0.0.0.0', () => {
    console.log('Sunucu 3000 portunda çalışıyor ve tüm ağ arayüzlerinden erişilebilir');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});