// Cuenta regresiva de la página de bloqueo. Archivo aparte para cumplir la CSP (sin scripts en línea).
const el = document.getElementById("reloj");
if (el) {
    let s = Number(el.dataset.segundos) || 0;
    const t = setInterval(() => {
        s--;
        if (s <= 0) { clearInterval(t); el.textContent = "0:00"; location.href = "/"; return; }
        el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }, 1000);
}
