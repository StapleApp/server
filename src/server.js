import { io } from 'socket.io-client';

const socket = io('http://localhost:3000'); // Sunucuya 3000 portundan bağlan

// Kullanıcı adını sunucuya göndermek için 'set-username' olayını tetikler
export const setUsername = (username) => {
  socket.emit('set-username', username);
};

// Kullanıcının bir odaya katılması için 'join-room' olayını tetikler
export const joinRoom = () => {
  socket.emit('join-room');
};

// Yeni bir kullanıcı bağlandığında 'user-connected' olayını dinler
export const onUserConnected = (callback) => {
  socket.on('user-connected', callback);
};

// Bir kullanıcı ayrıldığında 'user-disconnected' olayını dinler
export const onUserDisconnected = (callback) => {
  socket.on('user-disconnected', callback);
};

// Kullanıcı listesini güncellemek için 'update-users' olayını dinler
export const onUpdateUsers = (callback) => {
  socket.on('update-users', callback);
};

// Başka bir kullanıcıdan gelen video görüşmesi davetini dinlemek için 'offer' olayını dinler
export const onOffer = (callback) => {
  socket.on('offer', callback);
};

// Kullanıcıdan gelen video çağrısını yanıtlamak için 'answer' olayını dinler
export const onAnswer = (callback) => {
  socket.on('answer', callback);
};

// ICE adaylarını almak için 'candidate' olayını dinler
export const onCandidate = (callback) => {
  socket.on('candidate', callback);
};

// Sunucuya bir video görüşmesi teklifi göndermek için 'offer' olayını tetikler
export const sendOffer = (userId, offer) => {
  socket.emit('offer', { userId, offer });
};

// Sunucuya bir video görüşmesi yanıtı göndermek için 'answer' olayını tetikler
export const sendAnswer = (userId, answer) => {
  socket.emit('answer', { userId, answer });
};

// Sunucuya ICE adayı göndermek için 'candidate' olayını tetikler
export const sendCandidate = (userId, candidate) => {
  socket.emit('candidate', { userId, candidate });
};

export default socket;
