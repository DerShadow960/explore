#!/usr/bin/env node
/**
 * Datos de demostración para los emuladores (npm run demo).
 * NUNCA corre contra producción: se niega si no hay emulador.
 *
 * Usuarios (contraseña para todos: pakal-demo-2026):
 *   coordinacion@up.edu.mx   General · Telecom, Control, Operaciones, Auditoria
 *   control@up.edu.mx        Mixcoac · Control
 *   telecom.cdup@up.edu.mx   CDUP    · Telecomunicaciones
 */

process.env.PAKAL_DEMO = "true";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const { config } = await import("../server/config.js");
const { iniciarFirebase, db, auth, Timestamp, FieldValue } = await import("../server/firebase.js");

if (!config.modoDemo || !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error("Este script solo corre contra emuladores.");
    process.exit(1);
}
iniciarFirebase(config);

const PASS = "pakal-demo-2026";
const USUARIOS = [
    { email: "coordinacion@up.edu.mx", nombre: "Rafa (Coordinación)", campus: "General", equipos: ["Telecomunicaciones", "Control", "Operaciones", "Auditoria"] },
    { email: "control@up.edu.mx", nombre: "Diego (Control)", campus: "Mixcoac", equipos: ["Control"] },
    { email: "telecom.cdup@up.edu.mx", nombre: "Ana (Telecom CDUP)", campus: "CDUP", equipos: ["Telecomunicaciones"] }
];

const uids = {};
for (const u of USUARIOS) {
    let user;
    try { user = await auth().getUserByEmail(u.email); }
    catch { user = await auth().createUser({ email: u.email, password: PASS, displayName: u.nombre }); }
    uids[u.email] = user.uid;
    await db().collection("usuarios").doc(user.uid).set({
        nombre: u.nombre, campus: u.campus, equipos: u.equipos, debeCambiarPassword: false
    });
}

const dia = (n, fin = true) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    d.setHours(fin ? 23 : 0, fin ? 59 : 0, fin ? 59 : 0, 0);
    return Timestamp.fromDate(d);
};
const TAREAS = [
    ["Mixcoac", "Telecomunicaciones", "Instalar antena QFH", "Todo el equipo", "En proceso", -5, 3],
    ["Mixcoac", "Telecomunicaciones", "Diseño Yagi-Uda", "Ana", "No empezado", 1, 12],
    ["Mixcoac", "Telecomunicaciones", "Automatizar 137.6 MHz", "Rafa", "No empezado", null, 7],
    ["Mixcoac", "Control", "Rotor de doble eje", "Diego", "En proceso", -10, 1],
    ["Mixcoac", "Control", "Troubleshooting Nema 17", "Diego", "Completado", -14, -2],
    ["Mixcoac", "Control", "Automatización de seguimiento PAKAL", "Equipo Control", "No empezado", 2, 20],
    ["Mixcoac", "Operaciones", "Gantt de integración 3U", "Coordinación", "En proceso", -3, 9],
    ["Mixcoac", "Operaciones", "Logística del hackathon", "Operaciones", "No empezado", null, -1],
    ["CDUP", "Telecomunicaciones", "Mitigación de RFI en estación CDUP", "Ana", "En proceso", -2, 6]
];
const lote = db().batch();
for (const [campus, equipo, titulo, responsable, estado, ini, fin] of TAREAS) {
    lote.set(db().collection("tareas").doc(), {
        campus, equipo, titulo, responsable, estado,
        fechaInicio: ini === null ? null : dia(ini, false),
        fechaFin: fin === null ? null : dia(fin),
        creadoPor: uids["coordinacion@up.edu.mx"],
        creado: FieldValue.serverTimestamp(), actualizado: FieldValue.serverTimestamp()
    });
}
lote.set(db().collection("chats").doc(), {
    canal: "General", campus: null, autor: "Rafa (Coordinación)", autorUid: uids["coordinacion@up.edu.mx"],
    texto: "Bienvenidos a la versión local de Mission Control 🚀", timestamp: FieldValue.serverTimestamp()
});
lote.set(db().collection("analisis").doc(), {
    archivo: { id: null, nombre: "rotor_control.ino", mime: "", url: null, modificado: null },
    equipo: "Control", campus: "Mixcoac", autor: "Diego (Control)", proveedor: "heuristico", modelo: "reglas-estaticas", truncado: false,
    resultado: {
        resumen: "Ejemplo sembrado: control de rotor con EasyComm. Usa delay() largos que bloquean la lectura serial.",
        lenguajes: ["Arduino (C++)"], calificacion: 6,
        hallazgos: [{ severidad: "media", tipo: "hardware", ubicacion: "loop()", descripcion: "delay(1000) bloquea el loop: el rotor ignora comandos durante un segundo.", sugerencia: "Temporiza con millis() o usa AccelStepper." }],
        fortalezas: ["Separa el parseo del protocolo del control de motores."],
        siguientes_pasos: ["Quitar delay() del loop principal.", "Agregar límites de carrera por software."]
    },
    creado: FieldValue.serverTimestamp()
});
await lote.commit();

console.log("✅ Datos de demo listos. Usuarios (contraseña: pakal-demo-2026):");
USUARIOS.forEach((u) => console.log(`   ${u.email.padEnd(26)} ${u.campus.padEnd(8)} ${u.equipos.join(", ")}`));
process.exit(0);
