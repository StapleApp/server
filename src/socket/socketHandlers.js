export function setupConnectionSocket(io) {
    io.on('connection', (socket) => {
        groupMessages(socket);
    });
}

function groupMessages(socket) {
    socket.on('createGroup', ({ groupName, members }) => {
        try {
            const groupId = createGroup(groupName, members);
            socket.emit('groupCreated', { groupId });
        } catch (error) {
            console.error('Error creating group:', error);
            socket.emit('error', { message: 'Failed to create group' });
        }
    });

    socket.on('sendMessage', ({ groupId, senderId, message }) => {
        try {
            const success = sendMessageToGroup(groupId, senderId, message);
            if (success) {
                socket.emit('messageSent', { groupId, senderId, message });
            } else {
                socket.emit('error', { message: 'Failed to send message' });
            }
        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });
}

function serverMessages(socket) {}

