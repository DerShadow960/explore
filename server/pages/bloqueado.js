/** Páginas que sirve el servidor cuando alguien intenta abrir el código a mano. */
import { escapar } from "../lib/html.js";

const envoltura = (titulo, cuerpo, conReloj = false) => `<!doctype html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapar(titulo)}</title>
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/bloqueado.css">
</head><body>
<img src="/assets/LogoUP.png" alt="Logo Explore UP" class="logo-explore">
<main class="bloqueo">${cuerpo}</main>
${conReloj ? `<script src="/js/lib/cuenta-regresiva.js"></script>` : ""}
</body></html>`;

// Texto honesto: decimos exactamente qué se registra, para qué y por cuánto
// tiempo. Antes decía "sé quién eres", que era falso (esta petición no lleva
// sesión, solo hay IP y navegador) e intimidante.
export const paginaMeme = (diasRetencion = 90) => envoltura("Nada que ver por aquí — Explore UP", `
    <h1>Neta??</h1>
    <img src="/assets/DUDE.jpg" alt="Meme" class="meme">
    <p>Esta dirección no es para abrirse en el navegador.</p>
    <p class="aviso-registro">Por seguridad registramos la <strong>dirección IP</strong>, el <strong>navegador</strong> y la
    <strong>hora</strong> de este intento. No sabemos quién eres: esta página no tiene acceso a tu sesión.
    El registro lo ve solo el equipo de auditoría y se borra a los ${Number(diasRetencion)} días.</p>
    <a class="volver" href="/">⬅ Volver a Mission Control</a>`);

export const paginaBloqueo = (segundos, intentosMax, diasRetencion = 90) => envoltura("Demasiados intentos — Explore UP", `
    <h1>🛑 Demasiados intentos</h1>
    <p>Llevas ${Number(intentosMax)} intentos de abrir el código de la plataforma.</p>
    <div class="reloj" id="reloj" data-segundos="${Number(segundos)}">${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}</div>
    <p>Espera a que termine la cuenta para volver a intentarlo.</p>
    <p class="aviso-registro">Registramos la IP, el navegador y la hora de cada intento; se borran a los ${Number(diasRetencion)} días.</p>
    <a class="volver" href="/">⬅ Volver a Mission Control</a>`, true);
