/**
 * Firebase Admin — una sola inicialización por proceso.
 * ============================================================
 * El Admin SDK SE SALTA las reglas de Firestore. Por eso solo vive en el
 * servidor, nunca se expone y cada endpoint que lo usa verifica primero
 * quién llama (middleware/auth.js).
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { config } from "./config.js";

let app = null;

export function iniciarFirebase(cfg = config) {
    if (app) return app;
    if (getApps().length) { app = getApps()[0]; return app; }

    if (cfg.modoDemo) {
        // Con estas variables el Admin SDK habla con los emuladores locales.
        process.env.FIRESTORE_EMULATOR_HOST ||= cfg.firebase.emuladores.firestore;
        process.env.FIREBASE_AUTH_EMULATOR_HOST ||= cfg.firebase.emuladores.auth;
        // Fija el proyecto para que la librería de Google no busque credenciales en la red
        // (eso producía el "MetadataLookupWarning ... ETIMEDOUT").
        process.env.GCLOUD_PROJECT = cfg.firebase.projectId;
        process.env.GOOGLE_CLOUD_PROJECT = cfg.firebase.projectId;
        app = initializeApp({ projectId: cfg.firebase.projectId });
    } else {
        app = initializeApp({
            credential: cert(cfg.firebase.cuentaDeServicio),
            projectId: cfg.firebase.projectId
        });
    }
    return app;
}

export function db() { iniciarFirebase(); return getFirestore(); }
export function auth() { iniciarFirebase(); return getAuth(); }
export { FieldValue, Timestamp };
