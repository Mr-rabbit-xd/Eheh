import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get } from "firebase/database";

// তোমার Firebase config দিয়ে replace করো
const firebaseConfig = {
  apiKey: "AIzaSyDOJRWTrO3A7_0SqvBxsCTt6bkNo8pV-bc",
  authDomain: "vcfweb-9bd1f.firebaseapp.com",
  databaseURL: "https://vcfweb-9bd1f-default-rtdb.firebaseio.com",
  projectId: "vcfweb-9bd1f",
  storageBucket: "vcfweb-9bd1f.appspot.com",
  messagingSenderId: "204316192596",
  appId: "1:204316192596:web:5b5d6052167c5dd270a2c1"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, get };
