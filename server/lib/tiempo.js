/**
 * Pone un tope de tiempo a una promesa. Firestore/Auth reintentan en
 * silencio cuando no hay red; sin tope, un análisis podría quedarse
 * esperando para siempre y el correo nunca saldría.
 */
export function conLimite(promesa, ms, mensaje = `Tiempo agotado (${ms} ms)`) {
    let timer;
    const limite = new Promise((_, mal) => { timer = setTimeout(() => mal(new Error(mensaje)), ms); timer.unref?.(); });
    return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}
