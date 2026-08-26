// إعداد Firebase المشترك لجميع صفحات المشروع
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDqxclAE2ZgkwffqoxUppO2p3oPGYdqDgI",
  authDomain: "mmmm-2eeb6.firebaseapp.com",
  projectId: "mmmm-2eeb6",
  storageBucket: "mmmm-2eeb6.firebasestorage.app",
  messagingSenderId: "864687939860",
  appId: "1:864687939860:web:044a597a874c79ceed2201",
  measurementId: "G-0G1E2XY1XZ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
