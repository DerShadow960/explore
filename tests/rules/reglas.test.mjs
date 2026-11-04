/**
 * Pruebas de firestore.rules contra el emulador (no toca producción).
 *   npm run test:rules      (requiere Java 21+; descarga el emulador la primera vez)
 */

import { test, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, getDocs,
    serverTimestamp, Timestamp
} from "firebase/firestore";

let env;
const PERFILES = {
    control: { nombre: "Diego", campus: "Mixcoac", equipos: ["Control"], debeCambiarPassword: true },
    telecomCdup: { nombre: "Ana", campus: "CDUP", equipos: ["Telecomunicaciones"], debeCambiarPassword: false },
    coord: { nombre: "Rafa", campus: "General", equipos: ["Control", "Auditoria"], debeCambiarPassword: false }
};

before(async () => {
    env = await initializeTestEnvironment({
        projectId: "demo-pakal",
        firestore: { rules: fs.readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 }
    });
});
after(() => env.cleanup());

beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        for (const [uid, p] of Object.entries(PERFILES)) await setDoc(doc(db, "usuarios", uid), p);
        await setDoc(doc(db, "tareas", "t-mix-control"), { equipo: "Control", campus: "Mixcoac", titulo: "Rotor", responsable: "Diego", estado: "No empezado", fechaInicio: null, fechaFin: null });
        await setDoc(doc(db, "tareas", "t-cdup"), { equipo: "Telecomunicaciones", campus: "CDUP", titulo: "RFI", responsable: "Ana", estado: "En proceso" });
        await setDoc(doc(db, "analisis", "a1"), { campus: "Mixcoac", equipo: "Control", resultado: {} });
        await setDoc(doc(db, "revisiones", "r1"), { campus: "Mixcoac", equipo: "Control", similitud: {}, revision: {} });
        await setDoc(doc(db, "accesos", "x1"), { ip: "1.1.1.1" });
    });
});

const como = (uid) => env.authenticatedContext(uid).firestore();
const anonimo = () => env.unauthenticatedContext().firestore();
const tareaNueva = (uid, extra = {}) => ({
    equipo: "Control", campus: "Mixcoac", titulo: "Nueva", responsable: "Yo", estado: "No empezado",
    fechaInicio: null, fechaFin: null, creadoPor: uid, creado: serverTimestamp(), actualizado: serverTimestamp(), ...extra
});

// ---------- usuarios ----------
test("cada quien lee solo su perfil", async () => {
    await assertSucceeds(getDoc(doc(como("control"), "usuarios", "control")));
    await assertFails(getDoc(doc(como("control"), "usuarios", "coord")));
    await assertFails(getDocs(collection(como("coord"), "usuarios")));
});
test("nadie se asciende: solo puede apagar debeCambiarPassword", async () => {
    await assertSucceeds(updateDoc(doc(como("control"), "usuarios", "control"), { debeCambiarPassword: false }));
    await assertFails(updateDoc(doc(como("control"), "usuarios", "control"), { campus: "General" }));
    await assertFails(updateDoc(doc(como("control"), "usuarios", "control"), { equipos: ["Control", "Auditoria"] }));
    await assertFails(setDoc(doc(como("nuevo"), "usuarios", "nuevo"), { nombre: "x", campus: "General", equipos: [] }));
});

// ---------- tareas ----------
test("lectura por campus: frontera dura", async () => {
    const q = (db, c) => getDocs(query(collection(db, "tareas"), where("campus", "==", c)));
    await assertSucceeds(q(como("control"), "Mixcoac"));
    await assertFails(q(como("control"), "CDUP"));
    await assertSucceeds(q(como("coord"), "CDUP"));
    await assertFails(q(anonimo(), "Mixcoac"));
    await assertFails(getDocs(collection(como("control"), "tareas")));
});
test("crear tarea: solo en mi área, con esquema válido y autoría propia", async () => {
    await assertSucceeds(addDoc(collection(como("control"), "tareas"), tareaNueva("control")));
    await assertFails(addDoc(collection(como("control"), "tareas"), tareaNueva("control", { equipo: "Operaciones" })));
    await assertFails(addDoc(collection(como("control"), "tareas"), tareaNueva("control", { campus: "CDUP" })));
    await assertFails(addDoc(collection(como("control"), "tareas"), tareaNueva("otro")));
    await assertFails(addDoc(collection(como("control"), "tareas"), tareaNueva("control", { estado: "Hackeado" })));
    await assertFails(addDoc(collection(como("control"), "tareas"), tareaNueva("control", { titulo: "x".repeat(200) })));
    await assertFails(addDoc(collection(como("control"), "tareas"), tareaNueva("control", { extra: true })));
    const tarde = Timestamp.fromDate(new Date(2026, 9, 30)), temprano = Timestamp.fromDate(new Date(2026, 9, 1));
    await assertFails(addDoc(collection(como("control"), "tareas"), tareaNueva("control", { fechaInicio: tarde, fechaFin: temprano })));
});
test("editar: no se muda de área ni de campus", async () => {
    const ref = (db) => doc(db, "tareas", "t-mix-control");
    await assertSucceeds(updateDoc(ref(como("control")), { estado: "En proceso", actualizado: serverTimestamp() }));
    await assertFails(updateDoc(ref(como("control")), { estado: "En proceso" }));        // sin sello de tiempo
    await assertFails(updateDoc(ref(como("control")), { equipo: "Operaciones", actualizado: serverTimestamp() }));
    await assertFails(updateDoc(ref(como("telecomCdup")), { estado: "Completado", actualizado: serverTimestamp() }));
    await assertFails(deleteDoc(ref(como("telecomCdup"))));
    await assertSucceeds(deleteDoc(ref(como("control"))));
});

// ---------- chats ----------
const msg = (uid, nombre, canal, campus, extra = {}) =>
    ({ canal, campus, autor: nombre, autorUid: uid, texto: "hola", timestamp: serverTimestamp(), ...extra });
test("chat global: cualquiera con perfil; firma y hora obligatorias", async () => {
    await assertSucceeds(addDoc(collection(como("telecomCdup"), "chats"), msg("telecomCdup", "Ana", "General", null)));
    await assertFails(addDoc(collection(como("telecomCdup"), "chats"), msg("control", "Ana", "General", null)));
    await assertFails(addDoc(collection(como("telecomCdup"), "chats"), msg("telecomCdup", "Rafa", "General", null)));
    await assertFails(addDoc(collection(como("telecomCdup"), "chats"), msg("telecomCdup", "Ana", "General", null, { timestamp: Timestamp.now() })));
    await assertFails(addDoc(collection(como("telecomCdup"), "chats"), msg("telecomCdup", "Ana", "General", null, { texto: "" })));
    await assertFails(addDoc(collection(como("sinperfil"), "chats"), msg("sinperfil", "X", "General", null)));
});
test("chat de campus y de área respetan la frontera", async () => {
    await assertSucceeds(addDoc(collection(como("control"), "chats"), msg("control", "Diego", "General", "Mixcoac")));
    await assertFails(addDoc(collection(como("control"), "chats"), msg("control", "Diego", "General", "CDUP")));
    await assertSucceeds(addDoc(collection(como("control"), "chats"), msg("control", "Diego", "Control", "Mixcoac")));
    await assertFails(addDoc(collection(como("control"), "chats"), msg("control", "Diego", "Operaciones", "Mixcoac")));
    const leer = (db, canal, campus) => getDocs(query(collection(db, "chats"), where("canal", "==", canal), where("campus", "==", campus)));
    await assertSucceeds(leer(como("control"), "General", null));
    await assertSucceeds(leer(como("control"), "Operaciones", "Mixcoac"));
    await assertFails(leer(como("control"), "Telecomunicaciones", "CDUP"));
});
test("los mensajes son inmutables", async () => {
    const db = como("control");
    const ref = await addDoc(collection(db, "chats"), msg("control", "Diego", "General", null));
    await assertFails(updateDoc(ref, { texto: "editado" }));
    await assertFails(deleteDoc(ref));
});

// ---------- sesiones, análisis, bitácora ----------
test("sesión única: solo la propia", async () => {
    const s = { sessionId: "abc", desde: serverTimestamp(), navegador: "test" };
    await assertSucceeds(setDoc(doc(como("control"), "sesiones", "control"), s));
    await assertFails(setDoc(doc(como("control"), "sesiones", "coord"), s));
    await assertFails(setDoc(doc(como("control"), "sesiones", "control"), { ...s, extra: 1 }));
});
test("análisis: se leen por campus y solo el servidor escribe", async () => {
    await assertSucceeds(getDoc(doc(como("control"), "analisis", "a1")));
    await assertFails(getDoc(doc(como("telecomCdup"), "analisis", "a1")));
    await assertFails(addDoc(collection(como("coord"), "analisis"), { campus: "Mixcoac", equipo: "Control" }));
});
test("revisiones de documentos: se leen por campus y solo el servidor escribe", async () => {
    await assertSucceeds(getDoc(doc(como("control"), "revisiones", "r1")));
    await assertFails(getDoc(doc(como("telecomCdup"), "revisiones", "r1")));
    await assertFails(addDoc(collection(como("coord"), "revisiones"), { campus: "Mixcoac", equipo: "Control" }));
    await assertFails(updateDoc(doc(como("coord"), "revisiones", "r1"), { revision: { resumen: "editado" } }));
});
test("bitácora: solo Auditoria lee, nadie escribe", async () => {
    await assertSucceeds(getDoc(doc(como("coord"), "accesos", "x1")));
    await assertFails(getDoc(doc(como("control"), "accesos", "x1")));
    await assertFails(addDoc(collection(como("coord"), "accesos"), { ip: "x" }));
    await assertFails(getDoc(doc(como("coord"), "accesos_control", "x")));
});
test("todo lo no listado está cerrado", async () => {
    await assertFails(setDoc(doc(como("coord"), "cualquiercosa", "x"), { a: 1 }));
    await assertFails(getDoc(doc(como("coord"), "cualquiercosa", "x")));
});
