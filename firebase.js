
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCu9vWPLZirLDRKD0IhyD1g2kbgl-urSM0",
  authDomain: "climatesheild-ai.firebaseapp.com",
  projectId: "climatesheild-ai",
  storageBucket: "climatesheild-ai.firebasestorage.app",
  messagingSenderId: "1074088695701",
  appId: "1:1074088695701:web:b0c84f54cfbd10038c489c",
  measurementId: "G-22PVXF7JCJ"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();