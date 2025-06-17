export function setupConnectionSocket(io) {
    io.on('connection', (socket) => {
        sendMessageToGroup(socket);
    });
}

function sendMessageToGroup(socket) {
    socket.on('sendMessage', ({ roomId, message }) => {
        
    });
}