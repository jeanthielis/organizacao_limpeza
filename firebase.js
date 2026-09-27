// firebase.js — ControlPoint 3.5
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, addDoc, getDocs, doc, deleteDoc, query,
  setDoc, updateDoc, where, getDoc, orderBy, limit, serverTimestamp, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, sendPasswordResetEmail,
  verifyPasswordResetCode, confirmPasswordReset, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js'

// --- Credenciais do projeto ---
const firebaseConfig = {
  apiKey: "AIzaSyAzkGqL3ezapXtGvSXcwBFiXnrEuAvrnpQ",
  authDomain: "controlpoint-1728a.firebaseapp.com",
  projectId: "controlpoint-1728a",
  storageBucket: "controlpoint-1728a.firebasestorage.app",
  messagingSenderId: "183053800864",
  appId: "1:183053800864:web:ee6124ad66384c25a0c0c5",
  measurementId: "G-WG867BJGKL"
};

let app, db, auth;

try {
  app = initializeApp(firebaseConfig);
  // Cache persistente: a app continua funcionando sem rede e sincroniza depois
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (err) {
    console.warn("Cache persistente indisponível, usando memória:", err.message);
    db = getFirestore(app);
  }
  auth = getAuth(app);
  console.log("%c✅ Firebase conectado", "color:#0d9488;font-weight:bold");
} catch (e) {
  console.error("❌ Erro na conexão Firebase:", e);
}

/**
 * Cria um usuário no Authentication SEM derrubar a sessão do administrador.
 * Usa uma instância secundária do app, que é descartada logo em seguida.
 */
async function createUserAsAdmin(email, password) {
  const secondary = initializeApp(firebaseConfig, 'secondary-' + Date.now());
  const secondaryAuth = getAuth(secondary);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    await signOut(secondaryAuth);
    return uid;
  } finally {
    try { await deleteApp(secondary); } catch (e) { /* ignore */ }
  }
}

export {
  db, auth, firebaseConfig,
  collection, addDoc, getDocs, doc, deleteDoc, query, setDoc, updateDoc,
  where, getDoc, orderBy, limit, serverTimestamp, arrayUnion,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, sendPasswordResetEmail,
  verifyPasswordResetCode, confirmPasswordReset, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential,
  createUserAsAdmin
};
