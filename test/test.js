import { collection, addDoc } from 'firebase/firestore';
import db from '../src/config/firebase-config.js';

async function addData() {
    try {
        const docRef = await addDoc(collection(db, "Groups"), {
            groupName: "Test Grubu"
        });
        console.log("Belge ID'si:", docRef.id);
    } catch (e) {
        console.error("Hata:", e);
    }
}

addData();