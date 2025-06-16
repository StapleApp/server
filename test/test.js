import { getGroupById, createGroup } from '../src/services/groupService.js';

console.log(createGroup({
    groupName: 'Test Group',
    users: [
        { userID: 'user1'},
        { userID: 'user2'}
    ],
    messages: [
        { senderID: 'user1', sendDate: new Date(), type: 'edited', message: 'Hello from user1' }
    ]
}));