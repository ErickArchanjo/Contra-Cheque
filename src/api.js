export const getToken = () => sessionStorage.getItem("tk");
export const setToken = (t) => (t ? sessionStorage.setItem("tk", t) : sessionStorage.removeItem("tk"));

// Mesma origem: em desenvolvimento o Vite faz proxy de /api para a API.
export async function api(path, { method = "GET", body } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method,
    headers: { ...(getToken() && { Authorization: "Bearer " + getToken() }), ...(body && !isForm && { "Content-Type": "application/json" }) },
    body: body && (isForm ? body : JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getToken()) { setToken(null); window.dispatchEvent(new Event("logout")); }
  if (!res.ok) throw new Error(data.erro || `Erro ${res.status}`);
  return data;
}

export async function apiBlob(path) {
  const res = await fetch(path, { headers: { Authorization: "Bearer " + getToken() } });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.erro || `Erro ${res.status}`); }
  return res.blob();
}
