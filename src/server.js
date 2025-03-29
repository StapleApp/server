// server.js (Node.js ve Express ile)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Bağlantı sağlandığında kullanıcıya "Client bağlandı" mesajı gönder
io.on('connection', (socket) => {
  console.log('A user connected');
  
  // Bağlanan client'a mesaj gönder
  socket.emit('message', 'Client bağlandı');

  // Client bağlantıdan çıktığında mesaj ver
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
