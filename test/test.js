import { getGroupById, createGroup } from '../src/services/groupService.js';


// const a = await createGroup("Test group", ["user1", "user2", "user3"]);
const b = await getGroupById('ojN1U6abfFpp83DEoBoc');

console.log(b);