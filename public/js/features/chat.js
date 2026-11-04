/**
 * Chats: por área (workspace) y flotante con dos pestañas
 *   "Explore UP" → canal General, campus null (todos)
 *   campus       → canal General, campus actual
 * Todo texto entra con textContent (anti-XSS).
 */

import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from "/vendor/firebase/firebase-firestore.js";
import { db } from "../firebase.js";
import { estado, suscribir, cancelarSuscripcion } from "../estado.js";
import { $, crear, vaciar, alternar, avisar } from "../ui/dom.js";
import { registrar } from "../ui/acciones.js";
import { CANAL_GLOBAL, LIMITES } from "../dominio.js";

const MAX_MENSAJES = 200;

function pintarMensajes(caja, snap) {
    if (!caja) return;
    const pegadoAbajo = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 40;
    const mensajes = [];
    snap.forEach((d) => mensajes.push(d.data()));
    mensajes.sort((a, b) => (a.timestamp?.toMillis() ?? Date.now()) - (b.timestamp?.toMillis() ?? Date.now()));

    caja.replaceChildren(...mensajes.slice(-MAX_MENSAJES).map((m) =>
        crear("div", { className: "msg" + (m.autorUid === estado.usuario?.uid ? " msg-propio" : "") },
            crear("span", { className: "author", text: m.autor }),
            crear("p", { text: m.texto }))));

    if (pegadoAbajo) caja.scrollTop = caja.scrollHeight;
}

async function enviar(canal, campus, input) {
    const texto = input.value.trim();
    if (!texto || !estado.usuario) return;
    input.value = "";
    try {
        await addDoc(collection(db, "chats"), {
            canal, campus,
            autor: estado.usuario.nombre,
            // El uid es la identidad; las reglas lo validan contra quien escribe.
            autorUid: estado.usuario.uid,
            texto: texto.slice(0, LIMITES.mensaje),
            timestamp: serverTimestamp()
        });
    } catch (e) {
        input.value = texto;   // no se pierde lo escrito
        avisar("No tienes permiso para escribir en este canal.", "error");
        console.error(e);
    }
}

// ---------------- Chat del área ----------------
export function cargarChatArea(equipo, campus) {
    const q = query(collection(db, "chats"), where("canal", "==", equipo), where("campus", "==", campus));
    vaciar("chat-box");
    suscribir("chat-area", onSnapshot(q, (s) => pintarMensajes($("chat-box"), s), (e) => console.error("Chat de área:", e)));
}

// ---------------- Chat global flotante ----------------
let abierto = false;
let noLeidos = 0;
let ultimoConteo = null;
let pestana = "global";

const campusDePestana = () => (pestana === "global" ? null : estado.campus);

function pintarPestanas() {
    $("tab-campus").textContent = estado.campus || "Campus";
    $("tab-global").classList.toggle("activa", pestana === "global");
    $("tab-campus").classList.toggle("activa", pestana === "campus");
}

function pintarBadge() {
    const b = $("global-chat-badge");
    b.textContent = noLeidos > 99 ? "99+" : String(noLeidos);
    b.classList.toggle("hidden", noLeidos === 0);
}

function suscribirGlobal() {
    ultimoConteo = null;
    const q = query(collection(db, "chats"), where("canal", "==", CANAL_GLOBAL), where("campus", "==", campusDePestana()));
    suscribir("chat-global", onSnapshot(q, (snap) => {
        pintarMensajes($("global-chat-box"), snap);
        // El primer snapshot es el histórico: no cuenta como no leído.
        if (ultimoConteo !== null && !abierto && snap.size > ultimoConteo) {
            noLeidos += snap.size - ultimoConteo;
            pintarBadge();
        }
        ultimoConteo = snap.size;
    }, (e) => console.error("Chat general:", e)));
}

export function mostrarChatGlobal() {
    alternar("global-chat-widget", true);
    pintarPestanas();
    // Si la pestaña era de otro campus, se vuelve a suscribir.
    suscribirGlobal();
}

export function ocultarChatGlobal() {
    cancelarSuscripcion("chat-global");
    alternar("global-chat-widget", false);
}

export function cerrarChatGlobal() {
    ocultarChatGlobal();
    abierto = false;
    noLeidos = 0;
    ultimoConteo = null;
    pestana = "global";
    vaciar("global-chat-box");
    alternar("global-chat-panel", false);
    alternar("global-chat-bubble", true);
    pintarBadge();
}

function toggle() {
    abierto = !abierto;
    alternar("global-chat-panel", abierto);
    alternar("global-chat-bubble", !abierto);
    if (abierto) {
        noLeidos = 0;
        pintarBadge();
        const caja = $("global-chat-box");
        caja.scrollTop = caja.scrollHeight;
        $("global-chat-input").focus();
    }
}

function cambiarPestana(el) {
    const cual = el.dataset.pestana;
    if (cual === pestana) return;
    pestana = cual;
    pintarPestanas();
    vaciar("global-chat-box");
    suscribirGlobal();
}

export function iniciarChat() {
    registrar({
        "chat-area": () => enviar(estado.equipo, estado.campus, $("chat-input")),
        "chat-global": () => enviar(CANAL_GLOBAL, campusDePestana(), $("global-chat-input")),
        "toggle-chat-global": toggle,
        "pestana-chat": cambiarPestana
    });
}
