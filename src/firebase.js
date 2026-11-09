import { initializeApp } from 'firebase/app'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)

// Local testing only: point at the Firestore emulator when this is set, e.g.
// VITE_FIRESTORE_EMULATOR=127.0.0.1:8080. Never set for production builds.
const emulator = import.meta.env.VITE_FIRESTORE_EMULATOR
if (emulator) {
  const [host, port] = emulator.split(':')
  connectFirestoreEmulator(db, host, Number(port))
}
