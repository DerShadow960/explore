/**
 * Entrada del servidor. Carga la configuración primero para que un .env
 * mal escrito se reporte con un mensaje claro en vez de un stack trace.
 *
 *   npm start      producción (Firebase real)
 *   npm run demo   emuladores locales
 */
try {
    await import("./config.js");
} catch (e) {
    console.error(`✖ Configuración inválida: ${e.message}`);
    console.error("  Revisa tu .env (plantilla en .env.example) y el README.");
    process.exit(1);
}
await import("./arranque.js");
