import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { setupConnectionSocket } from './socket/socketHandlers.js';

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

setupConnectionSocket(io);