/** Lee un File del navegador como base64 (sin el prefijo data:). */
export function leerBase64(archivo) {
    return new Promise((ok, mal) => {
        const lector = new FileReader();
        lector.onload = () => ok(String(lector.result).split(",")[1] || "");
        lector.onerror = () => mal(new Error("No se pudo leer el archivo."));
        lector.readAsDataURL(archivo);
    });
}
