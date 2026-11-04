/**
 * Cabeceras de seguridad y CSP.
 * ============================================================
 * La CSP es estricta: solo scripts propios ('self'). Por eso el frontend
 * no tiene ningún onclick ni <script> en línea, y Firebase/SheetJS se
 * sirven desde /vendor en vez de gstatic/cdnjs.
 */

import helmet from "helmet";
import crypto from "node:crypto";

export function crearSeguridad(config) {
    const auth = config.firebase.web.authDomain;
    const emu = config.modoDemo
        ? [`http://${config.firebase.emuladores.auth}`, `http://${config.firebase.emuladores.firestore}`,
            `ws://${config.firebase.emuladores.firestore}`]
        : [];

    return helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https://*.googleusercontent.com", "https://www.google.com"],
                fontSrc: ["'self'"],
                connectSrc: [
                    "'self'",
                    "https://*.googleapis.com",
                    "https://*.firebaseio.com",
                    "wss://*.firebaseio.com",
                    "https://apis.google.com",
                    ...emu
                ],
                // Login con Google: el popup usa un iframe del authDomain.
                frameSrc: ["'self'", ...(auth ? [`https://${auth}`] : []), "https://accounts.google.com", "https://apis.google.com"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'none'"]
            }
        },
        // El popup de Google necesita poder comunicarse con la ventana que lo abrió.
        crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
        crossOriginEmbedderPolicy: false,
        referrerPolicy: { policy: "strict-origin-when-cross-origin" },
        hsts: false   // es local, sin HTTPS; si lo expones con TLS, actívalo
    });
}

export function permisos(req, res, next) {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    next();
}

/** Nonce por respuesta, para las pocas páginas del servidor con script propio. */
export function nonce() {
    return crypto.randomBytes(16).toString("base64");
}
