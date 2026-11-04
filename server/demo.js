/**
 * Arranque en modo demo (emuladores). Archivo aparte para que
 * `npm run demo` funcione igual en Linux, macOS y Windows.
 */
process.env.PAKAL_DEMO = "true";
await import("./index.js");
