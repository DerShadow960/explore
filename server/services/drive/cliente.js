/**
 * Cliente mínimo de Google Drive (API v3) con cuenta de servicio.
 * ============================================================
 * La cuenta de servicio NO ve tu Drive personal. Para que vea una
 * carpeta, compártela con el correo de la cuenta de servicio
 * (xxx@proyecto.iam.gserviceaccount.com) como "Lector".
 * Alcance de solo lectura: este servidor nunca modifica Drive.
 */

import { drive as crearDrive, auth as gauth } from "@googleapis/drive";
import { MIME_CARPETA, MIME_GDOC } from "./extractor.js";

const CAMPOS = "id,name,mimeType,size,modifiedTime,createdTime,md5Checksum,version,webViewLink,parents," +
    "lastModifyingUser(displayName,emailAddress),owners(displayName,emailAddress)";

export function crearClienteDrive(cuentaDeServicio) {
    const autenticacion = new gauth.GoogleAuth({
        credentials: cuentaDeServicio,
        scopes: ["https://www.googleapis.com/auth/drive.readonly"]
    });
    const api = crearDrive({ version: "v3", auth: autenticacion });
    const comunes = { supportsAllDrives: true, includeItemsFromAllDrives: true };

    async function listarTodo(q, campos = CAMPOS) {
        const archivos = [];
        let pageToken;
        do {
            const { data } = await api.files.list({
                ...comunes, q, pageSize: 200, pageToken,
                fields: `nextPageToken,files(${campos})`
            });
            archivos.push(...(data.files || []));
            pageToken = data.nextPageToken;
        } while (pageToken && archivos.length < 5000);
        return archivos;
    }

    // Los IDs de Drive son [A-Za-z0-9_-]; se valida para que no se pueda
    // inyectar nada en la consulta q.
    const idSeguro = (id) => {
        if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error(`ID de carpeta inválido: ${id}`);
        return id;
    };

    return {
        cuenta: cuentaDeServicio.client_email,

        async carpeta(id) {
            const { data } = await api.files.get({ ...comunes, fileId: idSeguro(id), fields: "id,name,mimeType" });
            return data;
        },

        /** Todas las subcarpetas (recursivo, profundidad máx. 6). */
        async subcarpetas(raiz) {
            const todas = [idSeguro(raiz)];
            let nivel = [raiz];
            for (let d = 0; d < 6 && nivel.length; d++) {
                const siguiente = [];
                for (const id of nivel) {
                    const hijas = await listarTodo(
                        `'${idSeguro(id)}' in parents and mimeType = '${MIME_CARPETA}' and trashed = false`, "id");
                    siguiente.push(...hijas.map((h) => h.id));
                }
                todas.push(...siguiente);
                nivel = siguiente;
            }
            return todas;
        },

        /** Archivos (no carpetas) modificados después de `desdeIso` en una carpeta. */
        async archivosModificados(carpetaId, desdeIso) {
            const filtroFecha = desdeIso ? ` and modifiedTime > '${new Date(desdeIso).toISOString()}'` : "";
            return listarTodo(
                `'${idSeguro(carpetaId)}' in parents and mimeType != '${MIME_CARPETA}' and trashed = false${filtroFecha}`);
        },

        async descargar(archivo, maxBytes) {
            if (archivo.mimeType === MIME_GDOC) {
                const { data } = await api.files.export(
                    { fileId: archivo.id, mimeType: "text/plain" }, { responseType: "arraybuffer" });
                return Buffer.from(data).subarray(0, maxBytes);
            }
            if (archivo.size && Number(archivo.size) > maxBytes) {
                throw new Error(`Archivo de ${archivo.size} bytes, por encima del límite (${maxBytes}).`);
            }
            const { data } = await api.files.get(
                { ...comunes, fileId: archivo.id, alt: "media" }, { responseType: "arraybuffer" });
            return Buffer.from(data);
        }
    };
}
