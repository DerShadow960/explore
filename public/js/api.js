/**
 * Cliente de la API local. Adjunta el ID token de Firebase en cada
 * llamada; el servidor lo verifica con el Admin SDK. Nunca se manda
 * campus/equipos/rol: eso lo decide el servidor con el token.
 */

import { auth } from "./firebase.js";

export async function api(ruta, { metodo = "GET", cuerpo } = {}) {
    const usuario = auth.currentUser;
    if (!usuario) throw new Error("No hay sesión.");
    const token = await usuario.getIdToken();
    const res = await fetch(ruta, {
        method: metodo,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(cuerpo ? { "Content-Type": "application/json" } : {})
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    let datos = null;
    try { datos = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok) throw new Error(datos?.error || `Error ${res.status}`);
    return datos;
}
