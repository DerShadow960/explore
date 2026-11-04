/**
 * Punto de entrada del frontend.
 *
 *   firebase.js      inicialización (config desde /api/config)
 *   estado.js        sesión, permisos y suscripciones
 *   dominio.js       campus, áreas, permisos puros (compartido con el servidor)
 *   ui/              DOM y delegación de eventos (sin onclick: CSP estricta)
 *   features/        un módulo por funcionalidad
 */

import { iniciarFirebase } from "./firebase.js";
import { iniciarAcciones } from "./ui/acciones.js";
import { $, mostrarVista } from "./ui/dom.js";
import { iniciarAuth } from "./features/auth.js";
import { iniciarNavegacion } from "./features/navegacion.js";
import { iniciarTareas } from "./features/tareas.js";
import { iniciarChat } from "./features/chat.js";
import { iniciarGantt } from "./features/gantt.js";
import { iniciarAccesos } from "./features/accesos.js";
import { iniciarAnalisis } from "./features/analisis.js";
import { iniciarAdmin } from "./features/admin.js";
import { iniciarRevisiones } from "./features/revisiones.js";

async function arrancar() {
    try {
        const { configPublica } = await iniciarFirebase();
        $("banner-demo").classList.toggle("hidden", !configPublica.demo);
    } catch (e) {
        console.error(e);
        mostrarVista("view-cargando");
        document.querySelector("#view-cargando .subtitulo").textContent =
            "No se pudo conectar con el servidor local. ¿Está corriendo `npm start`?";
        return;
    }

    iniciarAcciones();
    iniciarNavegacion();
    iniciarTareas();
    iniciarChat();
    iniciarGantt();
    iniciarAccesos();
    iniciarAnalisis();
    iniciarAdmin();
    iniciarRevisiones();
    iniciarAuth();          // al final: dispara la primera vista
}

arrancar();
