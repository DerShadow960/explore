/**
 * Autenticación, perfil y sesión única.
 */

import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword,
    GoogleAuthProvider, signInWithPopup
} from "/vendor/firebase/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp } from "/vendor/firebase/firebase-firestore.js";
import { auth, db } from "../firebase.js";
import { estado, suscribir, cancelarTodas } from "../estado.js";
import { $, mostrarVista, mostrarError, avisar } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { DOMINIO_PERMITIDO, perfilValido, LIMITES } from "../dominio.js";
import { irASelectorCampus } from "./navegacion.js";
import { cerrarChatGlobal } from "./chat.js";

const entroConGoogle = (user) => (user.providerData || []).some((p) => p.providerId === "google.com");

// ------------------------------------------------------------
// Sesión única por navegador.
// Un id por NAVEGADOR (localStorage), no por pestaña: dos pestañas del
// mismo navegador comparten sesión de Firebase. Si otro navegador entra
// con la misma cuenta, escribe su id en sesiones/{uid} y éste se cierra.
// Corre en el cliente: es un candado para gente honesta, no una barrera.
// ------------------------------------------------------------
const CLAVE_SESION = "pakal_session_id";
let miSesionId = null;
let expulsado = false;

function obtenerSesionId() {
    if (miSesionId) return miSesionId;
    try {
        miSesionId = localStorage.getItem(CLAVE_SESION);
        if (!miSesionId) {
            miSesionId = crypto.randomUUID();
            localStorage.setItem(CLAVE_SESION, miSesionId);
        }
    } catch {
        miSesionId = crypto.randomUUID();
    }
    return miSesionId;
}

async function registrarSesion(uid) {
    const id = obtenerSesionId();
    try {
        await setDoc(doc(db, "sesiones", uid), {
            sessionId: id,
            desde: serverTimestamp(),
            navegador: (navigator.userAgent || "").slice(0, LIMITES.navegador)
        });
    } catch (e) {
        console.error("No se pudo registrar la sesión; la sesión única NO está activa.", e);
        return;
    }
    suscribir("sesion", onSnapshot(doc(db, "sesiones", uid), (snap) => {
        if (!snap.exists() || expulsado) return;
        if (snap.data().sessionId !== id) {
            expulsado = true;
            cerrarSesion();
            avisar("Tu cuenta se abrió en otro dispositivo. Esta sesión se cerró.", "error", 10000);
        }
    }, (err) => console.error("Vigilancia de sesión:", err)));
}

// ------------------------------------------------------------
// Login
// ------------------------------------------------------------
async function login(form) {
    const email = $("login-id").value.trim();
    const pass = $("login-pass").value;
    mostrarError("login-error", "");
    if (!email || !pass) return mostrarError("login-error", "Llena ambos campos.");

    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
        // Mensaje genérico a propósito: no revelamos si existe el correo.
        mostrarError("login-error", e.code === "auth/too-many-requests"
            ? "Demasiados intentos. Espera unos minutos."
            : "Credenciales incorrectas.");
    } finally {
        boton.disabled = false;
    }
}

async function loginGoogle() {
    mostrarError("login-error", "");
    const provider = new GoogleAuthProvider();
    // `hd` es solo sugerencia para el selector; el dominio se valida abajo.
    provider.setCustomParameters({ hd: DOMINIO_PERMITIDO, prompt: "select_account" });
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        if (["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e.code)) return;
        const mensajes = {
            "auth/popup-blocked": "Tu navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo de nuevo.",
            "auth/account-exists-with-different-credential": "Ese correo ya tiene contraseña en la plataforma. Entra con correo y contraseña.",
            "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase. Agrega localhost en Authentication → Settings → Dominios autorizados."
        };
        mostrarError("login-error", mensajes[e.code] || "No se pudo iniciar sesión con Google.");
        console.error(e);
    }
}

async function expulsar(mensaje) {
    await signOut(auth);
    mostrarVista("view-login");
    mostrarError("login-error", mensaje);
}

async function alCambiarSesion(user) {
    if (!user) {
        estado.usuario = null;
        mostrarVista("view-login");
        return;
    }

    if (entroConGoogle(user) && !(user.email || "").toLowerCase().endsWith("@" + DOMINIO_PERMITIDO)) {
        return expulsar(`Con Google solo se puede entrar con un correo @${DOMINIO_PERMITIDO}.`);
    }

    let snap;
    try {
        snap = await getDoc(doc(db, "usuarios", user.uid));
    } catch (e) {
        console.error(e);
        return expulsar("No se pudo leer tu perfil. Revisa tu conexión.");
    }
    const perfil = snap.exists() ? { uid: user.uid, email: user.email, ...snap.data() } : null;
    if (!perfil) return expulsar("Tu cuenta no tiene un perfil asignado en Mission Control. Contacta a Rafa para que te dé de alta.");
    if (!perfilValido(perfil)) return expulsar("Tu perfil está incompleto (falta nombre, campus o equipos). Contacta a Rafa.");

    estado.usuario = perfil;

    // Quien entra con Google no tiene contraseña que cambiar.
    if (perfil.debeCambiarPassword && entroConGoogle(user)) {
        try {
            await updateDoc(doc(db, "usuarios", user.uid), { debeCambiarPassword: false });
            perfil.debeCambiarPassword = false;
        } catch (e) { console.error("No se pudo limpiar debeCambiarPassword:", e); }
    }

    expulsado = false;
    await registrarSesion(user.uid);

    if (perfil.debeCambiarPassword) mostrarVista("view-password");
    else irASelectorCampus();
}

async function cambiarPassword() {
    const p1 = $("new-pass").value;
    const p2 = $("new-pass-2").value;
    mostrarError("password-error", "");
    if (p1.length < 10) return mostrarError("password-error", "Mínimo 10 caracteres.");
    if (p1 !== p2) return mostrarError("password-error", "Las contraseñas no coinciden.");
    if (!/[A-Za-z]/.test(p1) || !/\d/.test(p1)) return mostrarError("password-error", "Usa letras y números.");

    try {
        await updatePassword(auth.currentUser, p1);
        await updateDoc(doc(db, "usuarios", estado.usuario.uid), { debeCambiarPassword: false });
        estado.usuario.debeCambiarPassword = false;
        $("new-pass").value = $("new-pass-2").value = "";
        irASelectorCampus();
    } catch (e) {
        console.error(e);
        mostrarError("password-error", e.code === "auth/requires-recent-login"
            ? "Por seguridad, cierra sesión y vuelve a entrar antes de cambiarla."
            : "No se pudo actualizar la contraseña.");
    }
}

export async function cerrarSesion() {
    cancelarTodas();
    cerrarChatGlobal();
    estado.campus = null;
    estado.equipo = null;
    $("login-id").value = "";
    $("login-pass").value = "";
    await signOut(auth).catch(() => {});
    mostrarVista("view-login");
}

export function iniciarAuth() {
    registrar({
        "login": login,
        "login-google": loginGoogle,
        "cambiar-password": cambiarPassword,
        "logout": cerrarSesion
    });
    onAuthStateChanged(auth, (user) => {
        alCambiarSesion(user).catch((e) => {
            console.error(e);
            expulsar("Ocurrió un error al iniciar sesión.");
        });
    });
}
