const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Aktif kullanıcılar listesi
let activeUsers = [];

io.on("connection", (socket) => {
  console.log("New user connected:", socket.id);

  // Kullanıcı bağlantı sağladığında aktif kullanıcılar listesine ekle
  activeUsers.push(socket.id);

  // Aktif kullanıcıları tüm clientlara gönder
  io.emit("update-users", activeUsers);

  // Kullanıcı bağlantıyı kestiğinde listeden çıkar
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    activeUsers = activeUsers.filter((userId) => userId !== socket.id);
    io.emit("update-users", activeUsers);
  });
});

server.listen(3001, () => {
  console.log("Server is running on port 3001");
});
