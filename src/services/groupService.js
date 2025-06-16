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

export async function createGroup(groupData) {
    try {
        const groupsCollectionRef = collection(db, 'Groups');
        const docRef = await addDoc(groupsCollectionRef, groupData);

        console.log('Group created with ID:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error creating group:', error);
        throw error;
    }
}