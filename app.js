import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, updateDoc, addDoc, query, where,
    onSnapshot, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";


const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentWorkspace = null;
let unsubscribeChat = null;
let unsubscribeTasks = null;

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
}

window.openWorkspace = function (teamName) {
    // No confiamos en que el botón no se haya manipulado: verificamos
    // otra vez que el usuario tenga acceso a ese equipo antes de abrir nada.
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

// ================= TAREAS =================
function loadTasks(teamName) {
    const q = query(collection(db, "tareas"), where("equipo", "==", teamName));
    unsubscribeTasks = onSnapshot(q, (snapshot) => {
        const taskBox = document.getElementById("task-list");
        taskBox.innerHTML = "";

        snapshot.forEach((d) => {
            const tarea = d.data();
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
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <select>
                        <option value="No empezado">⚪ No empezado</option>
                        <option value="En proceso">⏳ En proceso</option>
                        <option value="Completado">✅ Completado</option>
                    </select>
                    <button style="background: transparent; color: #ff6b6b; border: none; padding: 0; font-size: 1.2em; min-width: auto;" title="Borrar Tarea">✖</button>
                </div>
            `;
            card.querySelector('[data-field="titulo"]').textContent = tarea.titulo;
            card.querySelector('[data-field="responsable"]').textContent = tarea.responsable;
            const select = card.querySelector("select");
            select.value = tarea.estado;
            select.addEventListener("change", () => cambiarEstadoTarea(d.id, select.value));
            card.querySelector("button").addEventListener("click", () => borrarTarea(d.id));

            taskBox.appendChild(card);
        });
    });
}

async function cambiarEstadoTarea(docId, nuevoEstado) {
    await updateDoc(doc(db, "tareas", docId), { estado: nuevoEstado });
}

window.agregarNuevaTarea = async function () {
    const titulo = prompt("Título de la nueva tarea:");
    if (!titulo || !titulo.trim()) return;
    const responsable = prompt("Responsable de la tarea (ej. Todo el equipo):");
    if (!responsable || !responsable.trim()) return;

    await addDoc(collection(db, "tareas"), {
        equipo: currentWorkspace,
        titulo: titulo.trim().slice(0, 199),
        responsable: responsable.trim().slice(0, 99),
        estado: "No empezado"
    });
};

async function borrarTarea(docId) {
    const confirmacion = confirm("¿Estás seguro de que quieres borrar esta tarea definitivamente?");
    if (!confirmacion) return;
    await deleteDoc(doc(db, "tareas", docId));
}

// ================= CHAT =================
function loadChat(teamName) {
    const q = query(collection(db, "chats"), where("canal", "==", teamName));

    unsubscribeChat = onSnapshot(q, (snapshot) => {
        const chatBox = document.getElementById("chat-box");
        chatBox.innerHTML = "";

        let mensajes = [];
        snapshot.forEach((d) => mensajes.push(d.data()));

        mensajes.sort((a, b) => {
            const timeA = a.timestamp ? a.timestamp.toMillis() : Date.now();
            const timeB = b.timestamp ? b.timestamp.toMillis() : Date.now();
            return timeA - timeB;
        });

        mensajes.forEach((msg) => {
            const div = document.createElement("div");
            div.className = "msg";
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
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

window.sendChatMessage = async function () {
    const input = document.getElementById("chat-input");
    const texto = input.value.trim();
    if (!texto) return;

    await addDoc(collection(db, "chats"), {
        canal: currentWorkspace,
        autor: currentUser.nombre,
        texto: texto.slice(0, 999),
        timestamp: serverTimestamp()
    });
    input.value = "";
};
