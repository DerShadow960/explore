import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, updateDoc, addDoc, query, where,
    onSnapshot, serverTimestamp, deleteDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB7DeDh678alLOmIhnw_ftM3YFir25i848",
  authDomain: "exploreupcontrol.firebaseapp.com",
  projectId: "exploreupcontrol",
  storageBucket: "exploreupcontrol.firebasestorage.app",
  messagingSenderId: "622863959029",
  appId: "1:622863959029:web:4673f0d6e6be38b2cfd6bc",
  measurementId: "G-G5GSQ83C98"
};


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentWorkspace = null;
let unsubscribeChat = null;
let unsubscribeTasks = null;
let unsubscribeGlobalChat = null;

// Canal abierto a todos los usuarios autenticados.
const CANAL_GLOBAL = "General";
// ============================================================
// Utilidad anti-XSS: nunca metemos texto de usuario con innerHTML
// directo. Esta función escapa los caracteres peligrosos.
// ============================================================
function esc(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function hideAll() {
    document.getElementById("view-login").classList.add("hidden");
    document.getElementById("view-password").classList.add("hidden");
    document.getElementById("view-hub").classList.add("hidden");
    document.getElementById("view-workspace").classList.add("hidden");
}

// ============================================================
// LOGIN — ahora usa Firebase Authentication de verdad.
// Ya no comparamos contraseñas nosotros ni las guardamos en Firestore.
// ============================================================
window.appLogin = async function () {
    const email = document.getElementById("login-id").value.trim();
    const pass = document.getElementById("login-pass").value.trim();
    const errorBox = document.getElementById("login-error");
    errorBox.style.display = "none";

    if (!email || !pass) {
        errorBox.textContent = "Llena ambos campos.";
        errorBox.style.display = "block";
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, pass);
        // el resto pasa en onAuthStateChanged, abajo
    } catch (error) {
        // Mensaje genérico a propósito: nunca decimos si falló el
        // correo o la contraseña, ni mostramos nada de la BD.
        errorBox.textContent = "Credenciales incorrectas.";
        errorBox.style.display = "block";
    }
};

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        currentUser = null;
        return;
    }
    const snap = await getDoc(doc(db, "usuarios", user.uid));
    if (!snap.exists()) {
        // Existe en Auth pero no tiene perfil en Firestore: no lo dejamos entrar.
        await signOut(auth);
        alert("Tu cuenta no tiene un perfil asignado. Contacta al administrador.");
        return;
    }
    currentUser = { uid: user.uid, ...snap.data() };

    if (currentUser.debeCambiarPassword) {
        hideAll();
        document.getElementById("view-password").classList.remove("hidden");
    } else {
        loadHub();
    }
});

window.updatePassword = async function () {
    const newPass = document.getElementById("new-pass").value.trim();
    if (newPass.length < 8) return alert("La contraseña debe tener al menos 8 caracteres.");

    try {
        await updatePassword(auth.currentUser, newPass);
        await updateDoc(doc(db, "usuarios", currentUser.uid), { debeCambiarPassword: false });
        currentUser.debeCambiarPassword = false;
        loadHub();
    } catch (error) {
        // updatePassword puede pedir reautenticación reciente si pasó
        // mucho tiempo desde el login. Se lo explicamos al usuario.
        alert("No se pudo actualizar la contraseña. Vuelve a iniciar sesión e inténtalo de nuevo.");
        console.error(error);
    }
};

window.logout = function () {
    if (unsubscribeChat) unsubscribeChat();
    if (unsubscribeTasks) unsubscribeTasks();
    if (unsubscribeGlobalChat) { unsubscribeGlobalChat(); unsubscribeGlobalChat = null; }
    cerrarWidgetChat();
    signOut(auth);
    hideAll();
    document.getElementById("login-id").value = "";
    document.getElementById("login-pass").value = "";
    document.getElementById("view-login").classList.remove("hidden");
};

function loadHub() {
    hideAll();
    document.getElementById("view-hub").classList.remove("hidden");
    const rol = currentUser.equipo;
    document.getElementById("card-control").style.display = (rol === "Control" || rol === "General") ? "block" : "none";
    document.getElementById("card-operaciones").style.display = (rol === "Operaciones" || rol === "General") ? "block" : "none";
    document.getElementById("card-telecom").style.display = (rol === "Telecomunicaciones" || rol === "General") ? "block" : "none";
    document.getElementById("global-chat-widget").classList.remove("hidden");
    if (!unsubscribeGlobalChat) loadGlobalChat();
}

window.openWorkspace = function (teamName) {
    if (currentUser.equipo !== teamName && currentUser.equipo !== "General") {
        alert("No tienes acceso a esta área.");
        return;
    }

    currentWorkspace = teamName;
    hideAll();
    document.getElementById("view-workspace").classList.remove("hidden");
    document.getElementById("workspace-title").textContent = `Área: ${teamName}`;

    const driveUrls = {
        "Control": "https://drive.google.com/drive/folders/1zCVAajjlZ3BLmskyQUjuXxSkY7AUs6Do?usp=drive_link",
        "Operaciones": "https://drive.google.com/drive/folders/1K1ToaZ3pDK-QLPp8l4OQcxXzUKo7kpE9?usp=drive_link",
        "Telecomunicaciones": "https://drive.google.com/drive/folders/1KQGeEaQ7SW6kmWfgUdt4HZteyOwkOltx?usp=drive_link"
    };
    document.getElementById("drive-link").href = driveUrls[teamName] || "#";

    loadTasks(teamName);
    loadChat(teamName);
};

window.goBackToHub = function () {
    if (unsubscribeChat) unsubscribeChat();
    if (unsubscribeTasks) unsubscribeTasks();
    loadHub();
};

function fechaAInput(ts) {
    if (!ts || typeof ts.toDate !== "function") return "";
    const d = ts.toDate();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mes}-${dia}`;
}

// "YYYY-MM-DD" -> Timestamp al final de ese día, en hora local.
// Se parsea a mano: new Date("2026-09-01") lo interpreta como UTC y en
// México se corre un día hacia atrás.
function inputAFecha(str) {
    if (!str) return null;
    const [a, m, d] = str.split("-").map(Number);
    if (!a || !m || !d) return null;
    return Timestamp.fromDate(new Date(a, m - 1, d, 23, 59, 59));
}

// Días entre hoy (medianoche local) y la fecha límite.
// 0 = vence hoy, negativo = ya venció.
function diasRestantes(ts) {
    if (!ts || typeof ts.toDate !== "function") return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = ts.toDate();
    limite.setHours(0, 0, 0, 0);
    return Math.round((limite - hoy) / 86400000);
}

function etiquetaVencimiento(tarea) {
    if (tarea.estado === "Completado") return { texto: "", clase: "" };

    const dias = diasRestantes(tarea.fechaFin);
    if (dias === null) return { texto: "Sin fecha", clase: "sin-fecha" };
    if (dias < 0) return { texto: `Vencida hace ${Math.abs(dias)} d`, clase: "vencida" };
    if (dias === 0) return { texto: "Vence hoy", clase: "vencida" };
    if (dias === 1) return { texto: "Mañana", clase: "urgente" };
    if (dias <= 3) return { texto: `En ${dias} días`, clase: "urgente" };
    if (dias <= 7) return { texto: `En ${dias} días`, clase: "proxima" };
    return { texto: `En ${dias} días`, clase: "lejana" };
}

// ================= TAREAS =================
function loadTasks(teamName) {
    const q = query(collection(db, "tareas"), where("equipo", "==", teamName));
    unsubscribeTasks = onSnapshot(q, (snapshot) => {
        const taskBox = document.getElementById("task-list");
        taskBox.innerHTML = "";

        // Más urgente arriba. Las tareas sin fecha y las completadas, al final.
        const tareas = [];
        snapshot.forEach((d) => tareas.push({ id: d.id, ...d.data() }));
        tareas.sort((a, b) => {
            if ((a.estado === "Completado") !== (b.estado === "Completado")) {
                return a.estado === "Completado" ? 1 : -1;
            }
            const da = a.fechaFin ? a.fechaFin.toMillis() : Infinity;
            const dbb = b.fechaFin ? b.fechaFin.toMillis() : Infinity;
            return da - dbb;
        });

        if (!tareas.length) {
            const vacio = document.createElement("p");
            vacio.style.opacity = "0.6";
            vacio.textContent = "Todavía no hay tareas en esta área.";
            taskBox.appendChild(vacio);
            return;
        }

        tareas.forEach((tarea) => taskBox.appendChild(construirTarjetaTarea(tarea)));
    });
}

function construirTarjetaTarea(tarea) {
    let color = "var(--panel-bg)";
    if (tarea.estado === "Completado") color = "var(--status-done)";
    if (tarea.estado === "En proceso") color = "var(--status-process)";

    const card = document.createElement("div");
    card.className = "task-card";
    card.style.borderLeftColor = color;
    card.innerHTML = `
        <div style="flex-grow: 1;">
            <h3 style="margin:0; font-size: 1em;" data-field="titulo"></h3>
            <small style="opacity: 0.7;">Responsable: <span data-field="responsable"></span></small>
            <div class="task-fecha">
                <label>Límite:
                    <input type="date" data-field="fecha">
                </label>
                <span class="badge-fecha"></span>
            </div>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
            <select>
                <option value="No empezado">No empezado</option>
                <option value="En proceso">En proceso</option>
                <option value="Completado">Completado</option>
            </select>
            <button style="background: transparent; color: #ff6b6b; border: none; padding: 0; font-size: 1.2em; min-width: auto;" title="Borrar Tarea">✖</button>
        </div>
    `;

    card.querySelector('[data-field="titulo"]').textContent = tarea.titulo;
    card.querySelector('[data-field="responsable"]').textContent = tarea.responsable;

    const inputFecha = card.querySelector('[data-field="fecha"]');
    inputFecha.value = fechaAInput(tarea.fechaFin);
    inputFecha.addEventListener("change", () => cambiarFechaTarea(tarea.id, inputFecha.value));

    const badge = card.querySelector(".badge-fecha");
    const etiqueta = etiquetaVencimiento(tarea);
    badge.textContent = etiqueta.texto;
    if (etiqueta.clase) badge.classList.add(etiqueta.clase);

    const select = card.querySelector("select");
    select.value = tarea.estado;
    select.addEventListener("change", () => cambiarEstadoTarea(tarea.id, select.value));
    card.querySelector("button").addEventListener("click", () => borrarTarea(tarea.id));

    return card;
}

async function cambiarEstadoTarea(docId, nuevoEstado) {
    await updateDoc(doc(db, "tareas", docId), { estado: nuevoEstado });
}

async function cambiarFechaTarea(docId, valorInput) {
    // Vaciar el campo borra la fecha (null), no rompe la tarea.
    await updateDoc(doc(db, "tareas", docId), { fechaFin: inputAFecha(valorInput) });
}

// --- Alta de tareas: formulario en línea, ya no prompt() ---
window.toggleFormularioTarea = function (mostrar) {
    const form = document.getElementById("nueva-tarea-form");
    const boton = document.getElementById("btn-nueva-tarea");
    form.classList.toggle("hidden", !mostrar);
    boton.classList.toggle("hidden", mostrar);
    if (mostrar) document.getElementById("nt-titulo").focus();
};

window.guardarNuevaTarea = async function () {
    const titulo = document.getElementById("nt-titulo").value.trim();
    const responsable = document.getElementById("nt-responsable").value.trim();
    const fecha = document.getElementById("nt-fecha").value;
    const error = document.getElementById("nt-error");

    error.style.display = "none";
    if (!titulo)      { error.textContent = "Ponle un título a la tarea.";  error.style.display = "block"; return; }
    if (!responsable) { error.textContent = "Falta el responsable.";        error.style.display = "block"; return; }

    await addDoc(collection(db, "tareas"), {
        equipo: currentWorkspace,
        titulo: titulo.slice(0, 199),
        responsable: responsable.slice(0, 99),
        estado: "No empezado",
        fechaFin: inputAFecha(fecha)
    });

    document.getElementById("nt-titulo").value = "";
    document.getElementById("nt-responsable").value = "";
    document.getElementById("nt-fecha").value = "";
    window.toggleFormularioTarea(false);
};

async function borrarTarea(docId) {
    const confirmacion = confirm("¿Estás seguro de que quieres borrar esta tarea definitivamente?");
    if (!confirmacion) return;
    await deleteDoc(doc(db, "tareas", docId));
}

// ================= CHAT =================
// Render compartido: solo nombre del autor + mensaje.
// Siempre con textContent, nunca innerHTML (anti-XSS).
const MAX_MENSAJES = 200;

function renderMensajes(boxId, snapshot) {
    const chatBox = document.getElementById(boxId);
    if (!chatBox) return;

    // Si el usuario está leyendo hacia arriba, no lo forzamos al final.
    const pegadoAbajo = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 40;

    let mensajes = [];
    snapshot.forEach((d) => mensajes.push(d.data()));

    mensajes.sort((a, b) => {
        const timeA = a.timestamp ? a.timestamp.toMillis() : Date.now();
        const timeB = b.timestamp ? b.timestamp.toMillis() : Date.now();
        return timeA - timeB;
    });
    mensajes = mensajes.slice(-MAX_MENSAJES);

    chatBox.innerHTML = "";
    mensajes.forEach((msg) => {
        const div = document.createElement("div");
        div.className = "msg";

        const author = document.createElement("span");
        author.className = "author";
        author.textContent = msg.autor;
        if (currentUser && msg.autor === currentUser.nombre) div.classList.add("msg-propio");

        const text = document.createElement("p");
        text.style.margin = "3px 0";
        text.textContent = msg.texto;

        div.appendChild(author);
        div.appendChild(text);
        chatBox.appendChild(div);
    });

    if (pegadoAbajo) chatBox.scrollTop = chatBox.scrollHeight;
}

async function enviarMensaje(canal, inputId) {
    const input = document.getElementById(inputId);
    const texto = input.value.trim();
    if (!texto || !currentUser) return;

    input.value = "";
    await addDoc(collection(db, "chats"), {
        canal: canal,
        autor: currentUser.nombre,
        texto: texto.slice(0, 999),
        timestamp: serverTimestamp()
    });
}

// --- Chat por equipo (workspace) ---
function loadChat(teamName) {
    const q = query(collection(db, "chats"), where("canal", "==", teamName));
    unsubscribeChat = onSnapshot(q, (snapshot) => renderMensajes("chat-box", snapshot));
}

window.sendChatMessage = function () {
    return enviarMensaje(currentWorkspace, "chat-input");
};

// --- Chat general flotante (visible en toda la plataforma) ---
let chatAbierto = false;
let noLeidos = 0;
let ultimoConteo = null; // null = todavía no llega el primer snapshot

function loadGlobalChat() {
    const q = query(collection(db, "chats"), where("canal", "==", CANAL_GLOBAL));
    unsubscribeGlobalChat = onSnapshot(
        q,
        (snapshot) => {
            renderMensajes("global-chat-box", snapshot);

            // El primer snapshot es el histórico: no cuenta como no leído.
            if (ultimoConteo !== null && !chatAbierto && snapshot.size > ultimoConteo) {
                noLeidos += snapshot.size - ultimoConteo;
                pintarBadge();
            }
            ultimoConteo = snapshot.size;
        },
        (err) => console.error("Chat general:", err)
    );
}

function pintarBadge() {
    const badge = document.getElementById("global-chat-badge");
    if (noLeidos > 0) {
        badge.textContent = noLeidos > 99 ? "99+" : noLeidos;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}

window.toggleGlobalChat = function () {
    chatAbierto = !chatAbierto;
    document.getElementById("global-chat-panel").classList.toggle("hidden", !chatAbierto);
    document.getElementById("global-chat-bubble").classList.toggle("hidden", chatAbierto);

    if (chatAbierto) {
        noLeidos = 0;
        pintarBadge();
        const box = document.getElementById("global-chat-box");
        box.scrollTop = box.scrollHeight;
        document.getElementById("global-chat-input").focus();
    }
};

function cerrarWidgetChat() {
    chatAbierto = false;
    noLeidos = 0;
    ultimoConteo = null;
    document.getElementById("global-chat-box").innerHTML = "";
    document.getElementById("global-chat-panel").classList.add("hidden");
    document.getElementById("global-chat-bubble").classList.remove("hidden");
    document.getElementById("global-chat-widget").classList.add("hidden");
    pintarBadge();
}

window.sendGlobalMessage = function () {
    return enviarMensaje(CANAL_GLOBAL, "global-chat-input");
};

// --- Enter para enviar en ambos chats ---
function enterEnvia(inputId, fn) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); fn(); }
    });
}
enterEnvia("chat-input", () => window.sendChatMessage());
enterEnvia("global-chat-input", () => window.sendGlobalMessage());