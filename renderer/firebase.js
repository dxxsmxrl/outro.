import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getDatabase, ref, push, onValue, set, remove, serverTimestamp, off, get } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyB8Rqm5tDurN_GkcgQb7rWeqjD2veOs6zY",
  authDomain: "outro-226f0.firebaseapp.com",
  projectId: "outro-226f0",
  storageBucket: "outro-226f0.firebasestorage.app",
  messagingSenderId: "11210790608",
  appId: "1:11210790608:web:5e60fd0e2ab8c1751470d5",
  databaseURL: "https://outro-226f0-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export { ref, push, onValue, set, remove, serverTimestamp, off, get };
export { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword };
