/**
 * Autenticación de la API local.
 * ============================================================
 * El navegador manda su ID token de Firebase en `Authorization: Bearer`.
 * Aquí se verifica con el Admin SDK (firma, expiración y revocación) y
 * se carga el perfil de Firestore. El cliente NUNCA dice quién es ni qué
 * permisos tiene: eso sale del token verificado y del perfil en servidor.
 */

import { auth, db } from "../firebase.js";
import { perfilValido, esAuditor, esCoordinacion } from "../../public/js/dominio.js";
import { crearLogger } from "../lib/logger.js";
import { conLimite } from "../lib/tiempo.js";

const log = crearLogger("auth");

export function requiereSesion() {
    return async (req, res, next) => {
        const cabecera = req.get("authorization") || "";
        const [tipo, token] = cabecera.split(" ");
        if (tipo !== "Bearer" || !token || token.length > 4096) {
            return res.status(401).json({ error: "Falta el token de sesión." });
        }
        try {
            const decodificado = await conLimite(auth().verifyIdToken(token, true), 10000, "Auth sin respuesta");
            const snap = await conLimite(db().collection("usuarios").doc(decodificado.uid).get(), 10000, "Firestore sin respuesta");
            const perfil = snap.exists ? { uid: decodificado.uid, ...snap.data() } : null;
            if (!perfilValido(perfil)) {
                return res.status(403).json({ error: "Tu cuenta no tiene un perfil válido en Mission Control." });
            }
            req.usuario = { ...perfil, email: decodificado.email || null };
            next();
        } catch (e) {
            log.warn("Token rechazado", { ip: req.ip, motivo: e.code || e.message });
            res.status(401).json({ error: "Sesión inválida o expirada." });
        }
    };
}

/** Solo coordinación (campus General) o auditoría. */
export function requiereAdmin() {
    return (req, res, next) => {
        const u = req.usuario;
        if (u && (esCoordinacion(u) || esAuditor(u))) return next();
        log.warn("Acceso de administración denegado", { uid: u?.uid, ruta: req.originalUrl });
        res.status(403).json({ error: "No tienes permiso para esta acción." });
    };
}
