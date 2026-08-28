import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword,
    GoogleAuthProvider, signInWithPopup, setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, query, where,
    orderBy, limit, onSnapshot, serverTimestamp, deleteDoc, Timestamp
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

const persistenciaLista = setPersistence(auth, browserSessionPersistence)
    .catch((e) => console.error("No se pudo fijar la persistencia de sesión:", e));

// ============================================================
// CONFIGURACIÓN — qué equipos existen en cada campus.
// Cambia aquí los nombres y ya; el resto del código los lee de acá.
// ============================================================
const EQUIPOS_POR_CAMPUS = {
    "Mixcoac": ["Telecomunicaciones", "Control", "Operaciones"],
    "CDUP":    ["Telecomunicaciones"]   // ← ajusta el nombre del equipo de CDUP
};

const CANAL_GLOBAL = "General";
const DOMINIO_PERMITIDO = "up.edu.mx";
const EQUIPO_BITACORA = "Auditoria";

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
let unsubscribeGantt = null;

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

// La bitácora de accesos no depende del campus, sino de un equipo aparte.
function puedeVerBitacora() {
    return misEquipos().includes(EQUIPO_BITACORA);
}

function equiposDelCampus(campus) {
    return EQUIPOS_POR_CAMPUS[campus] || [];
}

// ============================================================
// NAVEGACIÓN
// ============================================================
const VISTAS = ["view-login", "view-password", "view-campus", "view-denegado", "view-hub", "view-workspace", "view-gantt", "view-accesos"];

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
        await persistenciaLista;
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        // Mensaje genérico a propósito: nunca decimos si falló el correo
        // o la contraseña, ni mostramos nada de la base de datos.
        errorBox.textContent = "Credenciales incorrectas.";
        errorBox.style.display = "block";
    }
};

// ============================================================
// LOGIN CON GOOGLE
// ============================================================
window.loginConGoogle = async function () {
    const errorBox = document.getElementById("login-error");
    errorBox.style.display = "none";

    const provider = new GoogleAuthProvider();
    // Sugerencia para el selector de cuentas de Google. No es una
    // restricción real: la validación de dominio la hacemos nosotros abajo.
    provider.setCustomParameters({ hd: DOMINIO_PERMITIDO, prompt: "select_account" });

    try {
        await persistenciaLista;
        await signInWithPopup(auth, provider);
        // El resto pasa en onAuthStateChanged.
    } catch (error) {
        if (error.code === "auth/popup-closed-by-user" ||
            error.code === "auth/cancelled-popup-request") {
            return;   // el usuario se arrepintió, no es un error
        }
        if (error.code === "auth/popup-blocked") {
            errorBox.textContent = "Tu navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo de nuevo.";
        } else if (error.code === "auth/account-exists-with-different-credential") {
            errorBox.textContent = "Ese correo ya tiene contraseña en la plataforma. Entra con correo y contraseña.";
        } else {
            errorBox.textContent = "No se pudo iniciar sesión con Google.";
            console.error(error);
        }
        errorBox.style.display = "block";
    }
};

function entroConGoogle(user) {
    return (user.providerData || []).some((p) => p.providerId === "google.com");
}

// ============================================================
// SESIÓN ÚNICA
// Un identificador por NAVEGADOR (no por pestaña): dos pestañas del
// mismo Chrome comparten sesión de Firebase, así que si usáramos un id
// por pestaña se expulsarían entre ellas.
// Al entrar se escribe el id en sesiones/{uid}; cada navegador escucha
// ese documento y si el id cambia, se cierra solo.
//
// Ojo: esto corre en el cliente. Alguien con la consola abierta puede
// desactivar el listener. Es un candado para gente honesta, no una
// barrera real — expulsar de verdad necesita el Admin SDK.
// ============================================================
const CLAVE_SESION = "pakal_session_id";
let miSesionId = null;
let unsubscribeSesion = null;
let expulsado = false;

function obtenerSesionId() {
    if (miSesionId) return miSesionId;
    try {
        miSesionId = localStorage.getItem(CLAVE_SESION);
        if (!miSesionId) {
            miSesionId = crypto.randomUUID();
            localStorage.setItem(CLAVE_SESION, miSesionId);
        }
    } catch (e) {
        // Modo incógnito o almacenamiento bloqueado: id efímero.
        miSesionId = crypto.randomUUID();
    }
    return miSesionId;
}

async function registrarSesion(uid) {
    const sesionId = obtenerSesionId();
    try {
        await setDoc(doc(db, "sesiones", uid), {
            sessionId: sesionId,
            desde: serverTimestamp(),
            navegador: (navigator.userAgent || "").slice(0, 199)
        });
    } catch (e) {
        // Si falla el registro no bloqueamos la entrada: la sesión única
        // es una comodidad, no debe dejar a nadie fuera de la plataforma.
        console.error(
            "No se pudo registrar la sesión — la sesión única NO está activa. " +
            "Revisa que el bloque match /sesiones/{uid} esté publicado en las reglas.", e);
        return;
    }

    if (unsubscribeSesion) unsubscribeSesion();
    unsubscribeSesion = onSnapshot(doc(db, "sesiones", uid), (snap) => {
        if (!snap.exists() || expulsado) return;
        if (snap.data().sessionId !== sesionId) {
            expulsado = true;
            if (unsubscribeSesion) { unsubscribeSesion(); unsubscribeSesion = null; }
            window.logout();
            alert("Tu cuenta se abrió en otro dispositivo. Esta sesión se cerró.");
        }
    }, (err) => console.error("Vigilancia de sesión:", err));
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        currentUser = null;
        return;
    }

    // Dominio institucional: solo aplica a Google. Las cuentas de
    // correo/contraseña que ya existen siguen entrando como siempre.
    if (entroConGoogle(user) && !(user.email || "").toLowerCase().endsWith("@" + DOMINIO_PERMITIDO)) {
        await signOut(auth);
        alert(`Con Google solo se puede entrar con un correo @${DOMINIO_PERMITIDO}.`);
        return;
    }

    const snap = await getDoc(doc(db, "usuarios", user.uid));
    if (!snap.exists()) {
        await signOut(auth);
        alert("Tu cuenta no tiene un perfil asignado en Mission Control. Contacta a Rafa para que te dé de alta.");
        return;
    }
    currentUser = { uid: user.uid, ...snap.data() };

    // Perfil sin migrar: sin campus ni equipos no se puede navegar nada.
    if (!currentUser.campus || !Array.isArray(currentUser.equipos)) {
        await signOut(auth);
        alert("Tu perfil está incompleto (falta campus o equipos). Contacta a Rafa.");
        return;
    }

    // Quien entra con Google no tiene contraseña que cambiar: la pantalla
    // de cambio lo dejaría atorado (updatePassword falla sin credencial).
    if (currentUser.debeCambiarPassword && entroConGoogle(user)) {
        try {
            await updateDoc(doc(db, "usuarios", currentUser.uid), { debeCambiarPassword: false });
            currentUser.debeCambiarPassword = false;
        } catch (e) {
            console.error("No se pudo limpiar debeCambiarPassword:", e);
        }
    }

    expulsado = false;
    await registrarSesion(user.uid);

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
    if (unsubscribeSesion) { unsubscribeSesion(); unsubscribeSesion = null; }
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

    // La bitácora es solo para quien tenga el equipo de auditoría.
    document.getElementById("btn-accesos").classList.toggle("hidden", !puedeVerBitacora());

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

// La fecha de inicio apunta al PRINCIPIO del día, para que la barra del
// Gantt cubra el día completo de inicio a fin.
function inputAFechaInicio(str) {
    if (!str) return null;
    const [a, m, d] = str.split("-").map(Number);
    if (!a || !m || !d) return null;
    return Timestamp.fromDate(new Date(a, m - 1, d, 0, 0, 0));
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
                <label>▶ Inicio:
                    <input type="date" data-field="fecha-inicio">
                </label>
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

    const inputInicio = card.querySelector('[data-field="fecha-inicio"]');
    inputInicio.value = fechaAInput(tarea.fechaInicio);
    inputInicio.disabled = !editable;
    if (editable) {
        inputInicio.addEventListener("change", () => cambiarFechaInicioTarea(tarea.id, inputInicio.value));
    }

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

async function cambiarFechaInicioTarea(docId, valorInput) {
    await updateDoc(doc(db, "tareas", docId), { fechaInicio: inputAFechaInicio(valorInput) });
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

    const inicio = document.getElementById("nt-fecha-inicio").value;
    if (inicio && fecha && inicio > fecha) {
        error.textContent = "La fecha de inicio no puede ser posterior a la límite.";
        error.style.display = "block";
        return;
    }

    try {
        await addDoc(collection(db, "tareas"), {
            equipo: currentWorkspace,
            campus: currentCampus,
            titulo: titulo.slice(0, 199),
            responsable: responsable.slice(0, 99),
            estado: "No empezado",
            fechaInicio: inputAFechaInicio(inicio),
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
    document.getElementById("nt-fecha-inicio").value = "";
    document.getElementById("nt-fecha").value = "";
    window.toggleFormularioTarea(false);
};

async function borrarTarea(docId) {
    if (!confirm("¿Estás seguro de que quieres borrar esta tarea definitivamente?")) return;
    await deleteDoc(doc(db, "tareas", docId));
}

// ============================================================
// GANTT — un cronograma por campus
//
// Una sola consulta (where campus == X) trae las tareas de las tres
// áreas: las reglas permiten leer todo el campus, así que no hace falta
// una consulta por equipo.
//
// Colores por estado. La paleta está validada para daltonismo: rojo y
// verde se confunden en deuteranopia (ΔE 5), que es justo la distinción
// que más importa aquí, así que "Completado" va en cian y "Vencida" en
// rosa-rojo (ΔE 9.5). Además cada barra lleva su estado por escrito:
// el color nunca es el único portador de la información.
// ============================================================
const COLOR_ESTADO = {
    "No empezado": "#78829c",
    "En proceso":  "#b8862c",
    "Completado":  "#2f9cb5",
    "Vencida":     "#dd5680"
};

const ZOOMS = { dia: 26, semana: 9, mes: 3.4 };
// Ancho de la columna de nombres: el eje de tiempo arranca después de ella,
// si no las barras tempranas quedan debajo de las etiquetas.
const ANCHO_ETIQUETA = 220;
let zoomGantt = "semana";
let tareasGantt = [];
let vistaTablaGantt = false;

function estadoVisual(tarea) {
    if (tarea.estado === "Completado") return "Completado";
    const dias = diasRestantes(tarea.fechaFin);
    if (dias !== null && dias < 0) return "Vencida";
    return tarea.estado;
}

const DIA_MS = 86400000;
const aMedianoche = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

window.abrirGantt = function () {
    mostrar("view-gantt");
    document.getElementById("gantt-campus").textContent = currentCampus;
    // El botón de descarga solo existe para coordinación (campus General).
    document.getElementById("btn-exportar").classList.toggle("hidden", currentUser.campus !== "General");
    cargarGantt();
};

window.cerrarGantt = function () {
    if (unsubscribeGantt) { unsubscribeGantt(); unsubscribeGantt = null; }
    loadHub();
};

function cargarGantt() {
    if (unsubscribeGantt) unsubscribeGantt();
    const q = query(collection(db, "tareas"), where("campus", "==", currentCampus));

    unsubscribeGantt = onSnapshot(q, (snapshot) => {
        tareasGantt = [];
        snapshot.forEach((d) => tareasGantt.push({ id: d.id, ...d.data() }));
        dibujarGantt();
    }, (err) => {
        console.error("Gantt:", err);
        document.getElementById("gantt-cuerpo").textContent = "No se pudieron cargar las tareas.";
    });
}

window.cambiarZoomGantt = function (nivel) {
    zoomGantt = nivel;
    ["dia", "semana", "mes"].forEach((z) =>
        document.getElementById("zoom-" + z).classList.toggle("activa", z === nivel));
    dibujarGantt();
};

window.alternarTablaGantt = function () {
    vistaTablaGantt = !vistaTablaGantt;
    document.getElementById("btn-tabla").textContent = vistaTablaGantt ? "📊 Ver cronograma" : "▦ Ver como tabla";
    dibujarGantt();
};

function dibujarGantt() {
    const cuerpo = document.getElementById("gantt-cuerpo");
    cuerpo.innerHTML = "";

    const conFecha = tareasGantt.filter((t) => t.fechaFin);
    if (!conFecha.length) {
        const p = document.createElement("p");
        p.style.opacity = "0.7";
        p.textContent = "No hay tareas con fecha límite en este campus. Ponles fecha desde el área correspondiente y aparecerán aquí.";
        cuerpo.appendChild(p);
        return;
    }

    if (vistaTablaGantt) { dibujarTablaGantt(cuerpo, conFecha); return; }

    // --- Rango de tiempo: desde la tarea más temprana hasta la más tardía,
    //     con margen, y siempre incluyendo hoy. ---
    const hoy = aMedianoche(new Date());
    let min = hoy, max = hoy;
    conFecha.forEach((t) => {
        const fin = aMedianoche(t.fechaFin.toDate());
        const ini = t.fechaInicio ? aMedianoche(t.fechaInicio.toDate()) : fin;
        if (ini < min) min = ini;
        if (fin > max) max = fin;
    });
    min = new Date(min.getTime() - 3 * DIA_MS);
    max = new Date(max.getTime() + 3 * DIA_MS);

    const pxDia = ZOOMS[zoomGantt];
    const totalDias = Math.round((max - min) / DIA_MS) + 1;
    const ancho = ANCHO_ETIQUETA + totalDias * pxDia;
    const xDe = (fecha) => ANCHO_ETIQUETA + ((aMedianoche(fecha) - min) / DIA_MS) * pxDia;

    const scroll = document.createElement("div");
    scroll.className = "gantt-scroll";
    const lienzo = document.createElement("div");
    lienzo.className = "gantt-lienzo";
    lienzo.style.width = ancho + "px";
    lienzo.style.minWidth = "100%";

    lienzo.appendChild(construirEncabezadoGantt(min, totalDias, pxDia));

    // Línea de hoy: la referencia más útil de todo el cronograma.
    const hoyX = xDe(hoy);
    if (hoyX >= 0 && hoyX <= ancho) {
        const linea = document.createElement("div");
        linea.className = "gantt-hoy";
        linea.style.left = hoyX + "px";
        linea.title = "Hoy";
        lienzo.appendChild(linea);
    }

    // --- Filas agrupadas por equipo ---
    const porEquipo = {};
    conFecha.forEach((t) => { (porEquipo[t.equipo] ||= []).push(t); });

    Object.keys(porEquipo).sort().forEach((equipo) => {
        const info = INFO_EQUIPOS[equipo] || { titulo: equipo };
        const editable = puedeEditar(equipo);

        const grupo = document.createElement("div");
        grupo.className = "gantt-grupo";
        grupo.textContent = info.titulo + (editable ? "" : "  · solo lectura");
        lienzo.appendChild(grupo);

        porEquipo[equipo]
            .sort((a, b) => a.fechaFin.toMillis() - b.fechaFin.toMillis())
            .forEach((tarea) => lienzo.appendChild(construirFilaGantt(tarea, xDe, pxDia, editable)));
    });

    scroll.appendChild(lienzo);
    cuerpo.appendChild(scroll);

    // Arranca centrado en hoy, no al inicio del rango.
    scroll.scrollLeft = Math.max(0, hoyX - scroll.clientWidth / 3);
}

function construirEncabezadoGantt(min, totalDias, pxDia) {
    const cabecera = document.createElement("div");
    cabecera.className = "gantt-cabecera";

    const meses = document.createElement("div");
    meses.className = "gantt-meses";
    const hueco = document.createElement("div");
    hueco.style.flex = "0 0 " + ANCHO_ETIQUETA + "px";
    meses.appendChild(hueco);
    const dias = document.createElement("div");
    dias.className = "gantt-dias";

    // Bandas de mes: se acumulan los días de cada mes y se cierra la banda
    // cuando cambia el mes o cuando se acaba el rango.
    let inicioBanda = 0;
    for (let i = 0; i <= totalDias; i++) {
        const fecha = i < totalDias ? new Date(min.getTime() + i * DIA_MS) : null;
        const anterior = new Date(min.getTime() + inicioBanda * DIA_MS);
        const cambiaMes = !fecha || fecha.getMonth() !== anterior.getMonth()
                                || fecha.getFullYear() !== anterior.getFullYear();

        if (cambiaMes && i > inicioBanda) {
            const banda = document.createElement("div");
            banda.className = "gantt-mes";
            banda.style.width = ((i - inicioBanda) * pxDia) + "px";
            const nom = anterior.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
            banda.textContent = nom.charAt(0).toUpperCase() + nom.slice(1);
            meses.appendChild(banda);
            inicioBanda = i;
        }
        if (!fecha) break;

        // Etiquetas de día solo si caben; si no, se marcan los lunes.
        const esLunes = fecha.getDay() === 1;
        if (pxDia >= 18 || (pxDia >= 6 && esLunes)) {
            const marca = document.createElement("div");
            marca.className = "gantt-dia" + (esLunes ? " lunes" : "");
            marca.style.left = (ANCHO_ETIQUETA + i * pxDia) + "px";
            marca.style.width = (pxDia >= 18 ? pxDia : pxDia * 7) + "px";
            marca.textContent = pxDia >= 18 ? fecha.getDate() : `${fecha.getDate()}/${fecha.getMonth() + 1}`;
            dias.appendChild(marca);
        }
    }

    cabecera.appendChild(meses);
    cabecera.appendChild(dias);
    return cabecera;
}

function construirFilaGantt(tarea, xDe, pxDia, editable) {
    const fila = document.createElement("div");
    fila.className = "gantt-fila";

    const etiqueta = document.createElement("div");
    etiqueta.className = "gantt-etiqueta";
    etiqueta.textContent = tarea.titulo;
    etiqueta.title = tarea.titulo;
    fila.appendChild(etiqueta);

    const estado = estadoVisual(tarea);
    const color = COLOR_ESTADO[estado] || COLOR_ESTADO["No empezado"];
    const fin = tarea.fechaFin.toDate();
    const tieneInicio = !!tarea.fechaInicio;

    let marca;
    if (tieneInicio) {
        marca = document.createElement("div");
        marca.className = "gantt-barra";
        const x0 = xDe(tarea.fechaInicio.toDate());
        const x1 = xDe(fin) + pxDia;          // la barra cubre el día de fin completo
        marca.style.left = x0 + "px";
        marca.style.width = Math.max(x1 - x0, 6) + "px";
        marca.style.background = color;
    } else {
        // Sin fecha de inicio no hay duración que dibujar: es un hito.
        marca = document.createElement("div");
        marca.className = "gantt-hito";
        marca.style.left = (xDe(fin) + pxDia / 2 - 7) + "px";
        marca.style.background = color;
    }
    if (!editable) marca.classList.add("gantt-bloqueada");

    const textoFechas = tieneInicio
        ? `${fmtCorta(tarea.fechaInicio.toDate())} → ${fmtCorta(fin)}`
        : `Entrega ${fmtCorta(fin)}`;

    marca.addEventListener("mouseenter", (e) => mostrarTooltip(e, tarea, estado, textoFechas));
    marca.addEventListener("mousemove", moverTooltip);
    marca.addEventListener("mouseleave", ocultarTooltip);
    marca.addEventListener("click", () => abrirEdicionGantt(tarea, editable));

    fila.appendChild(marca);
    return fila;
}

const fmtCorta = (d) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });

// --- Tooltip ---
function mostrarTooltip(e, tarea, estado, textoFechas) {
    const tip = document.getElementById("gantt-tooltip");
    tip.innerHTML = "";
    const filas = [
        ["", tarea.titulo],
        ["Área", INFO_EQUIPOS[tarea.equipo]?.titulo || tarea.equipo],
        ["Responsable", tarea.responsable],
        ["Estado", estado],
        ["Fechas", textoFechas]
    ];
    filas.forEach(([k, v], i) => {
        const linea = document.createElement("div");
        if (i === 0) { linea.className = "tt-titulo"; linea.textContent = v; }
        else { linea.className = "tt-linea"; linea.textContent = `${k}: ${v}`; }
        tip.appendChild(linea);
    });
    tip.classList.remove("hidden");
    moverTooltip(e);
}

function moverTooltip(e) {
    const tip = document.getElementById("gantt-tooltip");
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 12);
    const y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 12);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
}

function ocultarTooltip() {
    document.getElementById("gantt-tooltip").classList.add("hidden");
}

// --- Edición desde el Gantt ---
function abrirEdicionGantt(tarea, editable) {
    ocultarTooltip();
    const panel = document.getElementById("gantt-edicion");
    document.getElementById("ge-titulo").textContent = tarea.titulo;
    document.getElementById("ge-meta").textContent =
        `${INFO_EQUIPOS[tarea.equipo]?.titulo || tarea.equipo} · ${tarea.responsable}`;

    const inicio = document.getElementById("ge-inicio");
    const fin = document.getElementById("ge-fin");
    const estado = document.getElementById("ge-estado");
    inicio.value = fechaAInput(tarea.fechaInicio);
    fin.value = fechaAInput(tarea.fechaFin);
    estado.value = tarea.estado;

    [inicio, fin, estado].forEach((el) => { el.disabled = !editable; });
    document.getElementById("ge-guardar").classList.toggle("hidden", !editable);
    document.getElementById("ge-aviso").classList.toggle("hidden", editable);

    document.getElementById("ge-guardar").onclick = async () => {
        const err = document.getElementById("ge-error");
        err.style.display = "none";
        if (inicio.value && fin.value && inicio.value > fin.value) {
            err.textContent = "El inicio no puede ser posterior al límite.";
            err.style.display = "block";
            return;
        }
        try {
            await updateDoc(doc(db, "tareas", tarea.id), {
                fechaInicio: inputAFechaInicio(inicio.value),
                fechaFin: inputAFecha(fin.value),
                estado: estado.value
            });
            window.cerrarEdicionGantt();
        } catch (e) {
            err.textContent = "No tienes permiso para modificar esta tarea.";
            err.style.display = "block";
            console.error(e);
        }
    };

    panel.classList.remove("hidden");
}

window.cerrarEdicionGantt = function () {
    document.getElementById("gantt-edicion").classList.add("hidden");
    document.getElementById("ge-error").style.display = "none";
};

// --- Vista de tabla (accesibilidad y pantallas angostas) ---
function dibujarTablaGantt(cuerpo, tareas) {
    const tabla = document.createElement("table");
    tabla.className = "gantt-tabla";
    tabla.innerHTML = `<thead><tr>
        <th>Tarea</th><th>Área</th><th>Responsable</th>
        <th>Inicio</th><th>Límite</th><th>Estado</th>
    </tr></thead>`;
    const tbody = document.createElement("tbody");

    tareas
        .slice()
        .sort((a, b) => a.fechaFin.toMillis() - b.fechaFin.toMillis())
        .forEach((t) => {
            const tr = document.createElement("tr");
            const estado = estadoVisual(t);
            [
                t.titulo,
                INFO_EQUIPOS[t.equipo]?.titulo || t.equipo,
                t.responsable,
                t.fechaInicio ? fmtCorta(t.fechaInicio.toDate()) : "—",
                fmtCorta(t.fechaFin.toDate()),
                estado
            ].forEach((valor, i) => {
                const td = document.createElement("td");
                td.textContent = valor;
                if (i === 5) {
                    const punto = document.createElement("span");
                    punto.className = "punto-estado";
                    punto.style.background = COLOR_ESTADO[estado];
                    td.prepend(punto);
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

    tabla.appendChild(tbody);
    cuerpo.appendChild(tabla);
}

// ============================================================
// EXPORTAR A EXCEL (solo campus General)
// SheetJS se carga bajo demanda: no le pesa la app a quien nunca exporta.
// ============================================================
// SheetJS se carga bajo demanda: no le pesa la app a quien nunca exporta.
async function cargarSheetJS() {
    if (window.XLSX) return;
    await new Promise((ok, mal) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = ok;
        s.onerror = () => mal(new Error("No se pudo cargar la librería de Excel."));
        document.head.appendChild(s);
    });
}

window.exportarXlsx = async function () {
    if (currentUser.campus !== "General") return;
    const btn = document.getElementById("btn-exportar");
    const textoOriginal = btn.textContent;
    btn.textContent = "Generando...";
    btn.disabled = true;

    try {
        await cargarSheetJS();

        const filas = tareasGantt.map((t) => ({
            Campus: t.campus,
            Área: INFO_EQUIPOS[t.equipo]?.titulo || t.equipo,
            Tarea: t.titulo,
            Responsable: t.responsable,
            Estado: t.estado,
            "Estado real": estadoVisual(t),
            Inicio: t.fechaInicio ? t.fechaInicio.toDate() : "",
            Límite: t.fechaFin ? t.fechaFin.toDate() : "",
            "Días restantes": t.fechaFin ? diasRestantes(t.fechaFin) : ""
        }));

        const hoja = XLSX.utils.json_to_sheet(filas, { cellDates: true });
        hoja["!cols"] = [
            { wch: 10 }, { wch: 22 }, { wch: 42 }, { wch: 18 },
            { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 15 }
        ];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, "Tareas");

        const hoy = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(libro, `PAKAL_${currentCampus}_${hoy}.xlsx`);
    } catch (e) {
        alert(e.message || "No se pudo generar el archivo.");
        console.error(e);
    } finally {
        btn.textContent = textoOriginal;
        btn.disabled = false;
    }
};

// ============================================================
// BITÁCORA DE ACCESOS (solo campus General)
// La escribe /api/bloqueado del lado del servidor. Aquí solo se consulta.
// ============================================================
let accesosCargados = [];

window.abrirAccesos = async function () {
    if (!puedeVerBitacora()) return;
    mostrar("view-accesos");
    const cuerpo = document.getElementById("accesos-cuerpo");
    cuerpo.textContent = "Cargando...";

    try {
        const q = query(collection(db, "accesos"), orderBy("cuando", "desc"), limit(200));
        const snap = await getDocs(q);
        accesosCargados = [];
        snap.forEach((d) => accesosCargados.push(d.data()));
        dibujarAccesos();
    } catch (e) {
        cuerpo.textContent = "No se pudieron cargar los accesos. Revisa las reglas de Firestore.";
        console.error(e);
    }
};

window.cerrarAccesos = function () { loadHub(); };

function dibujarAccesos() {
    const cuerpo = document.getElementById("accesos-cuerpo");
    cuerpo.innerHTML = "";

    document.getElementById("accesos-total").textContent =
        `${accesosCargados.length} intento${accesosCargados.length === 1 ? "" : "s"} registrado${accesosCargados.length === 1 ? "" : "s"}`;

    if (!accesosCargados.length) {
        const p = document.createElement("p");
        p.style.opacity = "0.7";
        p.textContent = "Todavía nadie ha intentado abrir /app.js directamente.";
        cuerpo.appendChild(p);
        return;
    }

    const tabla = document.createElement("table");
    tabla.className = "gantt-tabla";
    tabla.innerHTML = `<thead><tr>
        <th>Cuándo</th><th>IP</th><th>Navegador</th><th>Intento</th><th>Resultado</th>
    </tr></thead>`;
    const tbody = document.createElement("tbody");

    accesosCargados.forEach((a) => {
        const tr = document.createElement("tr");
        const cuando = a.cuando?.toDate
            ? a.cuando.toDate().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
            : "—";
        [
            cuando,
            a.ip || "—",
            navegadorCorto(a.navegador),
            a.intentoNumero ? `#${a.intentoNumero}` : "—",
            a.bloqueado ? "🛑 Bloqueado" : "Registrado"
        ].forEach((valor, i) => {
            const td = document.createElement("td");
            td.textContent = valor;
            if (i === 2) td.title = a.navegador || "";
            if (i === 4 && a.bloqueado) td.style.color = "#dd5680";
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    tabla.appendChild(tbody);
    cuerpo.appendChild(tabla);
}

// El user-agent completo es ilegible en una tabla; se resume al navegador
// y el sistema, y el original queda en el title del td.
function navegadorCorto(ua) {
    if (!ua) return "—";
    const nav = /Edg\//.test(ua) ? "Edge"
              : /OPR\//.test(ua) ? "Opera"
              : /Chrome\//.test(ua) ? "Chrome"
              : /Firefox\//.test(ua) ? "Firefox"
              : /Safari\//.test(ua) ? "Safari" : "Otro";
    const so = /Android/.test(ua) ? "Android"
             : /iPhone|iPad/.test(ua) ? "iOS"
             : /Windows/.test(ua) ? "Windows"
             : /Mac OS/.test(ua) ? "macOS"
             : /Linux/.test(ua) ? "Linux" : "";
    return so ? `${nav} · ${so}` : nav;
}

window.exportarAccesos = async function () {
    if (!puedeVerBitacora() || !accesosCargados.length) return;
    await cargarSheetJS();
    const filas = accesosCargados.map((a) => ({
        Cuándo: a.cuando?.toDate ? a.cuando.toDate() : "",
        IP: a.ip || "",
        Navegador: navegadorCorto(a.navegador),
        "User-Agent": a.navegador || "",
        Referer: a.referer || "",
        Intento: a.intentoNumero || "",
        Bloqueado: a.bloqueado ? "Sí" : "No"
    }));
    const hoja = XLSX.utils.json_to_sheet(filas, { cellDates: true });
    hoja["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 50 }, { wch: 28 }, { wch: 9 }, { wch: 11 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Accesos");
    XLSX.writeFile(libro, `PAKAL_accesos_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

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
            // El uid queda amarrado al mensaje y las reglas lo validan contra
            // quien escribe. El nombre es para mostrar; el uid es la identidad.
            autorUid: currentUser.uid,
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
