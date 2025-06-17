import { collection, doc, getDoc, addDoc } from 'firebase/firestore';
import db from '../config/firebase-config.js';

export async function getGroupById(groupId) {
    try {
        const groupDocRef = doc(db, 'Groups', groupId);
        const groupDoc = await getDoc(groupDocRef);

        if (!groupDoc.exists()) {
            throw new Error('Group not found');
        }

        return groupDoc.data();
    } catch (error) {
        console.error('Error getting group:', error);
        throw error;
    }
}

export async function sendMessageToGroup(groupId, senderId, message) {
    try {
        const groupDocRef = doc(db, 'Groups', groupId);
        const groupDoc = await getDoc(groupDocRef);

        if (!groupDoc.exists()) {
            throw new Error('Group not found');
        }

        const groupData = groupDoc.data();
        const messages = groupData.messages || [];

        messages.push({
            senderID: senderId,
            sendDate: new Date().toISOString(),
            type: 'sent',
            message
        });

        await groupDocRef.update({ messages });

        return true;
    } catch (error) {
        console.error('Error sending message to group:', error);
        throw error;
    }
}

export async function createGroup(groupName, users) {
    try {
        const groupsCollectionRef = collection(db, 'Groups');
        const docRef = await addDoc(groupsCollectionRef, {
            groupName,
            users,
            messages: []
        });

        return docRef.id;
    } catch (error) {
        console.error('Error creating group:', error);
        throw error;
    }
}