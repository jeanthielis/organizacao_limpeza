// firebase.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'
// AQUI ESTAVA O ERRO: Havia duas linhas importando getFirestore. Agora só tem uma com getDoc incluso.
import { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, query, setDoc, where, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js'

// --- SUBSTITUA PELAS SUAS CHAVES DO FIREBASE CONSOLE ---
const firebaseConfig = {
  apiKey: "AIzaSyAzkGqL3ezapXtGvSXcwBFiXnrEuAvrnpQ",
  authDomain: "controlpoint-1728a.firebaseapp.com",
  projectId: "controlpoint-1728a",
  storageBucket: "controlpoint-1728a.firebasestorage.app",
  messagingSenderId: "183053800864",
  appId: "1:183053800864:web:ee6124ad66384c25a0c0c5",
  measurementId: "G-WG867BJGKL"
};

// Inicializa a conexão
let app, db, auth;

try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    console.log("Firebase conectado com sucesso!");
} catch (e) {
    console.error("Erro na conexão Firebase:", e);
}

// Exporta as instâncias e as funções para serem usadas no app.js
export { 
    db, 
    auth, 
    collection, 
    addDoc, 
    getDocs, 
    doc, 
    deleteDoc, 
    query,
    setDoc,
    where,
    getDoc, // <--- Importante: getDoc está sendo exportado aqui
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut
};
