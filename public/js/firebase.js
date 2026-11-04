/**
 * Inicialización de Firebase en el navegador.
 * El SDK se sirve desde /vendor (mismo origen) para que la CSP
 * pueda ser 'self' sin excepciones. La configuración llega de
 * /api/config, así que cambiar de proyecto (o usar emuladores)
 * no requiere tocar el código.
 */

import { initializeApp } from "/vendor/firebase/firebase-app.js";
import {
    getAuth, connectAuthEmulator, setPersistence, browserSessionPersistence
} from "/vendor/firebase/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "/vendor/firebase/firebase-firestore.js";

export let app = null;
export let auth = null;
export let db = null;
export let configPublica = null;

export async function iniciarFirebase() {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo leer la configuración del servidor.");
    configPublica = await res.json();

    app = initializeApp(configPublica.firebase);
    auth = getAuth(app);
    db = getFirestore(app);

    if (configPublica.demo && configPublica.emuladores) {
        connectAuthEmulator(auth, `http://${configPublica.emuladores.auth}`, { disableWarnings: true });
        const [host, puerto] = configPublica.emuladores.firestore.split(":");
        connectFirestoreEmulator(db, host, Number(puerto));
    }

    // La sesión muere al cerrar la pestaña.
    await setPersistence(auth, browserSessionPersistence).catch((e) =>
        console.error("No se pudo fijar la persistencia de sesión:", e));

    return { app, auth, db, configPublica };
}
