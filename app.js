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

// ============================================================
// CONFIGURACIÓN — qué equipos existen en cada campus.
// Cambia aquí los nombres y ya; el resto del código los lee de acá.
// ============================================================
const EQUIPOS_POR_CAMPUS = {
    "Mixcoac": ["Telecomunicaciones", "Control", "Operaciones"],
    "CDUP":    ["Telecomunicaciones"]   // ← ajusta el nombre del equipo de CDUP
};

const CANAL_GLOBAL = "General";

// Metadatos de presentación por equipo.
const INFO_EQUIPOS = {
    "Telecomunicaciones": {
        titulo: "Telecomunicaciones",
        img: "assets/IMAGEN_TELECOM.jpg",
        drive: "https://drive.google.com/drive/folders/1KQGeEaQ7SW6kmWfgUdt4HZteyOwkOltx?usp=drive_link"
    },
    "Control": {
        titulo: "Sistemas de Control",
        img: "assets/IMAGEN_CONTROL.jpg",
        drive: "https://drive.google.com/drive/folders/1zCVAajjlZ3BLmskyQUjuXxSkY7AUs6Do?usp=drive_link"
    },
    "Operaciones": {
        titulo: "Dirección de Operaciones",
        img: "assets/atlanta2.png",
        drive: "https://drive.google.com/drive/folders/1K1ToaZ3pDK-QLPp8l4OQcxXzUKo7kpE9?usp=drive_link"
    }
};

// ============================================================
// ESTADO
// ============================================================
let currentUser = null;
let currentCampus = null;      // campus que se está viendo
let currentWorkspace = null;   // equipo abierto
let unsubscribeChat = null;
let unsubscribeTasks = null;
let unsubscribeGlobalChat = null;

// ============================================================
// PERMISOS (espejo de las Firestore Rules — el servidor manda)
// Esto solo controla qué se ve; la seguridad real está en las reglas.
// ============================================================
function misEquipos() {
    return (currentUser && Array.isArray(currentUser.equipos)) ? currentUser.equipos : [];
}

function puedeEntrarACampus(campus) {
    if (!currentUser) return false;
    return currentUser.campus === "General" || currentUser.campus === campus;
}

// Editar exige ser miembro del equipo Y estar en un campus permitido.
function puedeEditar(equipo) {
    return misEquipos().includes(equipo) && puedeEntrarACampus(currentCampus);
}

function equiposDelCampus(campus) {
    return EQUIPOS_POR_CAMPUS[campus] || [];
}

// ============================================================
// NAVEGACIÓN
// ============================================================
const VISTAS = ["view-login", "view-password", "view-campus", "view-denegado", "view-hub", "view-workspace"];

function hideAll() {
    VISTAS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });
}

function mostrar(id) {
    hideAll();
    document.getElementById(id).classList.remove("hidden");
}

// ============================================================
// LOGIN
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
    } catch (error) {
        // Mensaje genérico a propósito: nunca decimos si falló el correo
        // o la contraseña, ni mostramos nada de la base de datos.
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
        await signOut(auth);
        alert("Tu cuenta no tiene un perfil asignado. Contacta al administrador.");
        return;
    }
    currentUser = { uid: user.uid, ...snap.data() };

    // Perfil sin migrar: sin campus ni equipos no se puede navegar nada.
    if (!currentUser.campus || !Array.isArray(currentUser.equipos)) {
        await signOut(auth);
        alert("Tu perfil está incompleto (falta campus o equipos). Contacta a Rafa.");
        return;
    }

    if (currentUser.debeCambiarPassword) {
        mostrar("view-password");
    } else {
        loadCampusSelector();
    }
});

window.updatePassword = async function () {
    const newPass = document.getElementById("new-pass").value.trim();
    if (newPass.length < 8) return alert("La contraseña debe tener al menos 8 caracteres.");

    try {
        await updatePassword(auth.currentUser, newPass);
        await updateDoc(doc(db, "usuarios", currentUser.uid), { debeCambiarPassword: false });
        currentUser.debeCambiarPassword = false;
        loadCampusSelector();
    } catch (error) {
        alert("No se pudo actualizar la contraseña. Vuelve a iniciar sesión e inténtalo de nuevo.");
        console.error(error);
    }
};

window.logout = function () {
    limpiarSuscripciones();
    if (unsubscribeGlobalChat) { unsubscribeGlobalChat(); unsubscribeGlobalChat = null; }
    cerrarWidgetChat();
    currentCampus = null;
    currentWorkspace = null;
    signOut(auth);
    document.getElementById("login-id").value = "";
    document.getElementById("login-pass").value = "";
    mostrar("view-login");
};

function limpiarSuscripciones() {
    if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
    if (unsubscribeTasks) { unsubscribeTasks(); unsubscribeTasks = null; }
}

// ============================================================
// SELECCIÓN DE CAMPUS
// ============================================================
function loadCampusSelector() {
    limpiarSuscripciones();
    currentCampus = null;
    currentWorkspace = null;
    document.getElementById("global-chat-widget").classList.add("hidden");
    document.getElementById("campus-saludo").textContent = `Hola, ${currentUser.nombre}`;
    mostrar("view-campus");
}

window.entrarCampus = function (campus) {
    if (!puedeEntrarACampus(campus)) {
        document.getElementById("denegado-campus").textContent = campus;
        mostrar("view-denegado");
        return;
    }
    currentCampus = campus;
    loadHub();
};

window.volverASelector = function () {
    loadCampusSelector();
};

// ============================================================
// HUB
// ============================================================
function loadHub() {
    limpiarSuscripciones();
    currentWorkspace = null;
    mostrar("view-hub");

    document.getElementById("hub-campus").textContent = currentCampus;

    const grid = document.getElementById("teams-grid");
    grid.innerHTML = "";

    equiposDelCampus(currentCampus).forEach((equipo) => {
        const info = INFO_EQUIPOS[equipo] || { titulo: equipo, img: "assets/LogoUP.png" };
        const editable = puedeEditar(equipo);

        const card = document.createElement("div");
        card.className = "team-card";
        card.innerHTML = `
            <img class="team-img" alt="">
            <h3 style="margin-top: 0;"></h3>
            <span class="badge-rol"></span>
            <button>Entrar al Espacio</button>
        `;
        const img = card.querySelector("img");
        img.src = info.img;
        img.alt = info.titulo;
        card.querySelector("h3").textContent = info.titulo;

        const badge = card.querySelector(".badge-rol");
        badge.textContent = editable ? "✏️ Puedes editar" : "👁 Solo lectura";
        badge.classList.add(editable ? "rol-editor" : "rol-lector");

        card.querySelector("button").addEventListener("click", () => window.openWorkspace(equipo));
        grid.appendChild(card);
    });

    // El chat general flotante se suscribe una sola vez por sesión.
    document.getElementById("global-chat-widget").classList.remove("hidden");
    pintarPestanasChat();
    if (!unsubscribeGlobalChat) loadGlobalChat();
}

window.openWorkspace = function (equipo) {
    // No confiamos en el botón: revalidamos que el equipo pertenezca a
    // este campus antes de abrir nada.
    if (!equiposDelCampus(currentCampus).includes(equipo)) {
        alert("Esa área no existe en este campus.");
        return;
    }

    currentWorkspace = equipo;
    const info = INFO_EQUIPOS[equipo] || { titulo: equipo, drive: "#" };
    const editable = puedeEditar(equipo);

    mostrar("view-workspace");
    document.getElementById("workspace-title").textContent = `${info.titulo} · ${currentCampus}`;
    document.getElementById("drive-link").href = info.drive || "#";

    // Modo solo lectura: se esconde todo lo que escribe.
    document.getElementById("aviso-lectura").classList.toggle("hidden", editable);
    document.getElementById("btn-nueva-tarea").classList.toggle("hidden", !editable);
    document.getElementById("nueva-tarea-form").classList.add("hidden");
    document.getElementById("chat-compositor").classList.toggle("hidden", !editable);

    loadTasks(equipo, currentCampus);
    loadChat(equipo, currentCampus);
};

window.goBackToHub = function () {
    limpiarSuscripciones();
    loadHub();
};

// ============================================================
// FECHAS
// Todo se guarda como Timestamp apuntando al FINAL del día local
// (23:59:59): "vence el 1 de septiembre" = tienes todo ese día.
// ============================================================
function fechaAInput(ts) {
    if (!ts || typeof ts.toDate !== "function") return "";
    const d = ts.toDate();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mes}-${dia}`;
}

// Se parsea a mano: new Date("2026-09-01") lo interpreta como UTC y en
// México se corre un día hacia atrás.
function inputAFecha(str) {
    if (!str) return null;
    const [a, m, d] = str.split("-").map(Number);
    if (!a || !m || !d) return null;
    return Timestamp.fromDate(new Date(a, m - 1, d, 23, 59, 59));
}

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

// ============================================================
// TAREAS
// ============================================================
function loadTasks(equipo, campus) {
    // Los dos filtros son obligatorios: sin campus, las reglas rechazan
    // la consulta completa.
    const q = query(
        collection(db, "tareas"),
        where("equipo", "==", equipo),
        where("campus", "==", campus)
    );

    unsubscribeTasks = onSnapshot(q, (snapshot) => {
        const taskBox = document.getElementById("task-list");
        taskBox.innerHTML = "";

        const tareas = [];
        snapshot.forEach((d) => tareas.push({ id: d.id, ...d.data() }));

        // Más urgente arriba; sin fecha y completadas al final.
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
    }, (err) => console.error("Tareas:", err));
}

function construirTarjetaTarea(tarea) {
    const editable = puedeEditar(tarea.equipo);

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
                <label>📅 Límite:
                    <input type="date" data-field="fecha">
                </label>
                <span class="badge-fecha"></span>
            </div>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
            <select>
                <option value="No empezado">⚪ No empezado</option>
                <option value="En proceso">⏳ En proceso</option>
                <option value="Completado">✅ Completado</option>
            </select>
            <button class="btn-borrar" title="Borrar Tarea">✖</button>
        </div>
    `;

    card.querySelector('[data-field="titulo"]').textContent = tarea.titulo;
    card.querySelector('[data-field="responsable"]').textContent = tarea.responsable;

    const inputFecha = card.querySelector('[data-field="fecha"]');
    inputFecha.value = fechaAInput(tarea.fechaFin);
    inputFecha.disabled = !editable;
    if (editable) {
        inputFecha.addEventListener("change", () => cambiarFechaTarea(tarea.id, inputFecha.value));
    }

    const badge = card.querySelector(".badge-fecha");
    const etiqueta = etiquetaVencimiento(tarea);
    badge.textContent = etiqueta.texto;
    if (etiqueta.clase) badge.classList.add(etiqueta.clase);

    const select = card.querySelector("select");
    select.value = tarea.estado;
    select.disabled = !editable;
    if (editable) {
        select.addEventListener("change", () => cambiarEstadoTarea(tarea.id, select.value));
    }

    const btnBorrar = card.querySelector(".btn-borrar");
    if (editable) {
        btnBorrar.addEventListener("click", () => borrarTarea(tarea.id));
    } else {
        btnBorrar.remove();
    }

    return card;
}

async function cambiarEstadoTarea(docId, nuevoEstado) {
    await updateDoc(doc(db, "tareas", docId), { estado: nuevoEstado });
}

async function cambiarFechaTarea(docId, valorInput) {
    // Vaciar el campo borra la fecha (null), no rompe la tarea.
    await updateDoc(doc(db, "tareas", docId), { fechaFin: inputAFecha(valorInput) });
}

window.toggleFormularioTarea = function (mostrarForm) {
    document.getElementById("nueva-tarea-form").classList.toggle("hidden", !mostrarForm);
    document.getElementById("btn-nueva-tarea").classList.toggle("hidden", mostrarForm);
    if (mostrarForm) document.getElementById("nt-titulo").focus();
};

window.guardarNuevaTarea = async function () {
    const titulo = document.getElementById("nt-titulo").value.trim();
    const responsable = document.getElementById("nt-responsable").value.trim();
    const fecha = document.getElementById("nt-fecha").value;
    const error = document.getElementById("nt-error");

    error.style.display = "none";
    if (!titulo)      { error.textContent = "Ponle un título a la tarea.";  error.style.display = "block"; return; }
    if (!responsable) { error.textContent = "Falta el responsable.";        error.style.display = "block"; return; }

    try {
        await addDoc(collection(db, "tareas"), {
            equipo: currentWorkspace,
            campus: currentCampus,
            titulo: titulo.slice(0, 199),
            responsable: responsable.slice(0, 99),
            estado: "No empezado",
            fechaFin: inputAFecha(fecha)
        });
    } catch (e) {
        error.textContent = "No tienes permiso para crear tareas aquí.";
        error.style.display = "block";
        console.error(e);
        return;
    }

    document.getElementById("nt-titulo").value = "";
    document.getElementById("nt-responsable").value = "";
    document.getElementById("nt-fecha").value = "";
    window.toggleFormularioTarea(false);
};

async function borrarTarea(docId) {
    if (!confirm("¿Estás seguro de que quieres borrar esta tarea definitivamente?")) return;
    await deleteDoc(doc(db, "tareas", docId));
}

// ============================================================
// CHAT
// Render compartido: solo nombre del autor + mensaje.
// Siempre con textContent, nunca innerHTML (anti-XSS).
// ============================================================
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
        if (currentUser && msg.autor === currentUser.nombre) div.classList.add("msg-propio");

        const author = document.createElement("span");
        author.className = "author";
        author.textContent = msg.autor;

        const text = document.createElement("p");
        text.style.margin = "3px 0";
        text.textContent = msg.texto;

        div.appendChild(author);
        div.appendChild(text);
        chatBox.appendChild(div);
    });

    if (pegadoAbajo) chatBox.scrollTop = chatBox.scrollHeight;
}

async function enviarMensaje(canal, campus, inputId) {
    const input = document.getElementById(inputId);
    const texto = input.value.trim();
    if (!texto || !currentUser) return;

    input.value = "";
    try {
        await addDoc(collection(db, "chats"), {
            canal: canal,
            campus: campus,
            autor: currentUser.nombre,
            texto: texto.slice(0, 999),
            timestamp: serverTimestamp()
        });
    } catch (e) {
        input.value = texto;   // no perdemos lo que escribió
        alert("No tienes permiso para escribir en este canal.");
        console.error(e);
    }
}

// --- Chat por equipo (workspace) ---
function loadChat(equipo, campus) {
    const q = query(
        collection(db, "chats"),
        where("canal", "==", equipo),
        where("campus", "==", campus)
    );
    unsubscribeChat = onSnapshot(q,
        (snapshot) => renderMensajes("chat-box", snapshot),
        (err) => console.error("Chat de equipo:", err)
    );
}

window.sendChatMessage = function () {
    return enviarMensaje(currentWorkspace, currentCampus, "chat-input");
};

// ============================================================
// CHAT GENERAL FLOTANTE — dos pestañas:
//   "Explore UP"  -> canal General, campus null (todos)
//   campus actual -> canal General, campus del usuario
// ============================================================
let chatAbierto = false;
let noLeidos = 0;
let ultimoConteo = null;
let pestanaChat = "global";     // "global" | "campus"

function campusDePestana() {
    return pestanaChat === "global" ? null : currentCampus;
}

function pintarPestanasChat() {
    document.getElementById("tab-campus").textContent = currentCampus || "Campus";
    document.getElementById("tab-global").classList.toggle("activa", pestanaChat === "global");
    document.getElementById("tab-campus").classList.toggle("activa", pestanaChat === "campus");
}

function loadGlobalChat() {
    if (unsubscribeGlobalChat) { unsubscribeGlobalChat(); unsubscribeGlobalChat = null; }
    ultimoConteo = null;

    const q = query(
        collection(db, "chats"),
        where("canal", "==", CANAL_GLOBAL),
        where("campus", "==", campusDePestana())
    );

    unsubscribeGlobalChat = onSnapshot(q,
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

window.cambiarPestanaChat = function (cual) {
    if (pestanaChat === cual) return;
    pestanaChat = cual;
    pintarPestanasChat();
    document.getElementById("global-chat-box").innerHTML = "";
    loadGlobalChat();
};

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
    pestanaChat = "global";
    document.getElementById("global-chat-box").innerHTML = "";
    document.getElementById("global-chat-panel").classList.add("hidden");
    document.getElementById("global-chat-bubble").classList.remove("hidden");
    document.getElementById("global-chat-widget").classList.add("hidden");
    pintarBadge();
}

window.sendGlobalMessage = function () {
    return enviarMensaje(CANAL_GLOBAL, campusDePestana(), "global-chat-input");
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
