import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

const firebaseConfig = {
  apiKey: "AIzaSyBfybWRqyZI22tACbYkzkotc-PdzXV6KuI",
  authDomain: "scuolabet-b45ee.firebaseapp.com",
  projectId: "scuolabet-b45ee",
  storageBucket: "scuolabet-b45ee.firebasestorage.app",
  messagingSenderId: "1013893033843",
  appId: "1:1013893033843:web:fd7d9edccf14f73d7d9f06"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const ai = getAI(app, { backend: new GoogleAIBackend() });
export const model = getGenerativeModel(ai, { model: "gemini-2.5-flash" });