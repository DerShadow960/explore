#!/usr/bin/env node
/**
 * Alta o actualización de usuarios (campus y equipos solo se asignan aquí,
 * nunca desde el cliente).
 *
 *   npm run usuario:crear -- --email a@up.edu.mx --nombre "Ana" --campus Mixcoac --equipos Control,Telecomunicaciones
 *   npm run usuario:crear -- --email a@up.edu.mx --campus General --equipos Control,Auditoria      (actualiza)
 *
 * Si la cuenta no existe se crea con una contraseña temporal aleatoria
 * que se imprime UNA vez, y se marca debeCambiarPassword.
 */

import crypto from "node:crypto";
import { config } from "../server/config.js";
import { iniciarFirebase, db, auth } from "../server/firebase.js";
import { CAMPUS, CAMPUS_COORDINACION, EQUIPOS, EQUIPO_AUDITORIA } from "../public/js/dominio.js";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split(/\s*--/).filter(Boolean)
    .map((p) => { const [k, ...v] = p.split(" "); return [k, v.join(" ").replace(/^"|"$/g, "").trim()]; }));

const email = (args.email || "").toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Falta --email válido."); process.exit(2);
}
const campus = args.campus;
if (campus && ![...CAMPUS, CAMPUS_COORDINACION].includes(campus)) {
    console.error(`--campus debe ser ${[...CAMPUS, CAMPUS_COORDINACION].join(" | ")}`); process.exit(2);
}
const equipos = args.equipos ? args.equipos.split(",").map((s) => s.trim()).filter(Boolean) : null;
const validos = [...EQUIPOS, EQUIPO_AUDITORIA];
if (equipos && equipos.some((e) => !validos.includes(e))) {
    console.error(`--equipos solo admite: ${validos.join(", ")}`); process.exit(2);
}

if (!config.modoDemo && !config.produccion) {
    console.error("Esto escribiría en el Firebase REAL. Corre con PAKAL_DEMO=true (emuladores) o pon PAKAL_PRODUCCION=true.");
    process.exit(2);
}
iniciarFirebase(config);

let user;
let temporal = null;
try {
    user = await auth().getUserByEmail(email);
    console.log(`Cuenta existente: ${user.uid}`);
} catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    temporal = crypto.randomBytes(9).toString("base64url");
    user = await auth().createUser({ email, password: temporal, displayName: args.nombre || undefined });
    console.log(`Cuenta creada: ${user.uid}`);
}

const ref = db().collection("usuarios").doc(user.uid);
const previo = (await ref.get()).data() || {};
const perfil = {
    nombre: args.nombre || previo.nombre || email.split("@")[0],
    campus: campus || previo.campus,
    equipos: equipos || previo.equipos || [],
    debeCambiarPassword: temporal ? true : (previo.debeCambiarPassword ?? false)
};
if (!perfil.campus) { console.error("Usuario nuevo: falta --campus."); process.exit(2); }

await ref.set(perfil);
console.log("Perfil:", perfil);
if (temporal) console.log(`\nContraseña temporal (se muestra una sola vez): ${temporal}\nAl entrar se le pedirá cambiarla.`);
process.exit(0);
