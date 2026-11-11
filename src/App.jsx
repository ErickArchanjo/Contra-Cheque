import { useEffect, useState, useCallback } from "react";
import { api, apiBlob, getToken, setToken } from "./api";

// Máscara de CPF: 000.000.000-00
const fmtCpf = (v) => String(v).replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d{1,3})?(\d{1,3})?(\d{1,2})?/, (m, a, b, c, e) => a + (b ? "." + b : "") + (c ? "." + c : "") + (e ? "-" + e : ""));

const Spin = () => <span className="mr-2 inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;

function useToast() {
  const [t, setT] = useState([]);
  const push = useCallback((m, err) => { const id = Math.random(); setT((x) => [...x, { id, m, err }]); setTimeout(() => setT((x) => x.filter((i) => i.id !== id)), 4500); }, []);
  const view = <div aria-live="polite" className="fixed bottom-3 right-3 z-50 grid max-w-[calc(100%-1.5rem)] gap-2">{t.map((i) => <div key={i.id} className={`rounded-md border-l-4 bg-slate-900 px-4 py-2 text-sm text-white ${i.err ? "border-red-400" : "border-green-400"}`}>{i.m}</div>)}</div>;
  return [push, view];
}

function Login({ onOk, toast }) {
  const [f, setF] = useState({ email: "", senha: "" }), [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); setBusy(true);
    try { const r = await api("/api/login", { method: "POST", body: f }); setToken(r.token); onOk(); } catch (x) { toast(x.message, true); } setBusy(false); };
  return (
    <form onSubmit={go} className="card mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">Portal de Contracheques</h1>
      <p className="mb-4 text-sm text-slate-500">Acesso restrito ao RH.</p>
      <label className="lbl"><span>E-mail</span><input className="inp" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="lbl"><span>Senha</span><input className="inp" type="password" required value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} /></label>
      <button className="btn w-full" disabled={busy}>{busy && <Spin />}Entrar</button>
    </form>);
}

const vazio = { nome: "", email: "", telefone: "", cpf: "", cargo: "", departamento: "", ativo: 1 };
function Colaboradores({ toast }) {
  const [rows, setRows] = useState([]), [q, setQ] = useState(""), [page, setPage] = useState(1), [edit, setEdit] = useState(null), [load, setLoad] = useState(true);
  const reload = useCallback(() => { setLoad(true); api(`/api/colaboradores?q=${encodeURIComponent(q)}&page=${page}`).then(setRows).catch((e) => toast(e.message, true)).finally(() => setLoad(false)); }, [q, page, toast]);
  useEffect(() => { const t = setTimeout(reload, 250); return () => clearTimeout(t); }, [reload]);
  const save = async (e) => { e.preventDefault();
    try { const { _file, _cpfLivre, ...d } = edit; const r = await api(d.id ? `/api/colaboradores/${d.id}` : "/api/colaboradores", { method: d.id ? "PUT" : "POST", body: { ...d, cpf: d.cpf.replace(/\D/g, "") } }); if (_file) { const fd = new FormData(); fd.append("arquivo", _file); await api(`/api/colaboradores/${d.id || r.id}/arquivo`, { method: "PUT", body: fd }); } toast("Colaborador salvo."); setEdit(null); reload(); } catch (x) { toast(x.message, true); } };
  const abrirEdicao = async (id) => { try { const u = await api(`/api/colaboradores/${id}`); setEdit({ ...u, cpf: fmtCpf(u.cpf || "") }); } catch (x) { toast(x.message, true); } };
  const removerArquivo = async () => { try { await api(`/api/colaboradores/${edit.id}/arquivo`, { method: "DELETE" }); setEdit({ ...edit, arquivo_nome: null }); toast("Arquivo removido."); reload(); } catch (x) { toast(x.message, true); } };
  const del = async (id) => { try { await api(`/api/colaboradores/${id}`, { method: "DELETE" }); toast("Colaborador desativado (exclusão lógica)."); reload(); } catch (x) { toast(x.message, true); } };
  return (<>
    <h1 className="text-xl font-semibold">Colaboradores</h1><p className="mb-4 text-sm text-slate-500">O CPF aparece mascarado na lista e completo apenas na edição.</p>
    <div className="mb-3 flex flex-wrap gap-2"><input className="inp min-w-48 flex-1" type="search" placeholder="Buscar por nome, e-mail ou departamento" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /><button className="btn" onClick={() => setEdit({ ...vazio })}>Novo colaborador</button></div>
    <div className="card overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
      <thead className="text-xs text-slate-500"><tr>{["Nome", "E-mail", "WhatsApp", "CPF", "Cargo", "Depto.", "Contracheque", "Status", ""].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{rows.map((u) => <tr key={u.id} className="border-t border-slate-200 dark:border-slate-700">
        <td className="p-2">{u.nome}</td><td className="p-2">{u.email}</td><td className="p-2">{u.telefone}</td><td className="p-2">{u.cpf}</td><td className="p-2">{u.cargo}</td><td className="p-2">{u.departamento}</td>
        <td className="p-2">{u.arquivo_nome || "—"}</td><td className="p-2">{u.ativo ? "Ativo" : "Inativo"}</td>
        <td className="space-x-1 whitespace-nowrap p-2"><button className="btn-g" onClick={() => abrirEdicao(u.id)}>Editar</button><button className="btn-g" onClick={() => del(u.id)}>Excluir</button></td></tr>)}
        {!rows.length && <tr><td colSpan={9} className="p-3 text-slate-500">{load ? "Carregando…" : "Nenhum colaborador encontrado. Ajuste a busca ou cadastre um novo."}</td></tr>}</tbody></table></div>
    <div className="flex items-center gap-3 text-sm"><button className="btn-g" disabled={page < 2} onClick={() => setPage(page - 1)}>Anterior</button>Página {page}<button className="btn-g" disabled={rows.length < 20} onClick={() => setPage(page + 1)}>Próxima</button></div>
    {edit && <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-3"><form onSubmit={save} className="card max-h-full w-full max-w-md overflow-y-auto">
      <h2 className="mb-3 font-semibold">{edit.id ? "Editar colaborador" : "Novo colaborador"}</h2>
      {[["nome", "Nome"], ["email", "E-mail"], ["telefone", "Telefone/WhatsApp"], ["cpf", "CPF (11 dígitos)"], ["cargo", "Cargo"], ["departamento", "Departamento"]].map(([k, l]) => <label key={k} className="lbl"><span>{l}</span><input className="inp" required inputMode={k === "cpf" ? "numeric" : undefined} placeholder={k === "cpf" ? "000.000.000-00" : undefined} readOnly={k === "cpf" && !!edit.id && !edit._cpfLivre} value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: k === "cpf" ? fmtCpf(e.target.value) : e.target.value })} />{k === "cpf" && !!edit.id && !edit._cpfLivre && <button type="button" className="btn-g mt-1" onClick={() => setEdit({ ...edit, _cpfLivre: true })}>Alterar CPF</button>}</label>)}
      <label className="lbl"><span>Contracheque padrão (PDF, PNG ou JPEG, até 5 MB)</span><input className="inp" type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setEdit({ ...edit, _file: e.target.files[0] || null })} /></label>
      {edit.arquivo_nome && !edit._file && <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">Arquivo atual: {edit.arquivo_nome}<button type="button" className="btn-g" onClick={removerArquivo}>Remover</button></p>}
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked ? 1 : 0 })} />Ativo</label>
      <div className="flex gap-2"><button className="btn">Salvar</button><button type="button" className="btn-g" onClick={() => setEdit(null)}>Cancelar</button></div></form></div>}
  </>);
}

function Envio({ toast }) {
  const [users, setUsers] = useState([]), [sel, setSel] = useState(new Set()), [em, setEm] = useState(false), [wa, setWa] = useState(false);
  const [assunto, setAssunto] = useState(""), [msg, setMsg] = useState(""), [file, setFile] = useState(null), [busy, setBusy] = useState(false);
  const [origem, setOrigem] = useState("novo");
  const semArquivo = users.filter((u) => sel.has(u.id) && !u.arquivo_nome).map((u) => u.nome);
  useEffect(() => { api("/api/colaboradores?per=200").then((r) => setUsers(r.filter((u) => u.ativo))).catch((e) => toast(e.message, true)); }, [toast]);
  const tog = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const enviar = async () => {
    if (!sel.size) return toast("Selecione ao menos um colaborador.", true);
    if (em && !assunto.trim()) return toast("Informe o assunto do e-mail.", true);
    if (origem === "novo" && !file) return toast("Anexe o contracheque.", true);
    if (origem === "cadastro" && semArquivo.length) return toast("Sem arquivo no cadastro: " + semArquivo.join(", "), true);
    const fd = new FormData(); sel.forEach((id) => fd.append("ids", id)); em && fd.append("canais", "email"); wa && fd.append("canais", "whatsapp");
    if (em) fd.append("assunto", assunto); fd.append("mensagem", msg); fd.append("origem", origem); if (origem === "novo") fd.append("arquivo", file);
    setBusy(true);
    try { const { resultado } = await api("/api/envios", { method: "POST", body: fd }); const ok = resultado.filter((r) => r.status === "enviado").length;
      toast(`${ok} de ${resultado.length} envios concluídos.`, ok < resultado.length); if (ok === resultado.length) { setSel(new Set()); setFile(null); } } catch (x) { toast(x.message, true); }
    setBusy(false); };
  return (<>
    <h1 className="text-xl font-semibold">Enviar contracheques</h1><p className="mb-4 text-sm text-slate-500">Escolha os destinatários, os canais e anexe o arquivo.</p>
    <div className="card"><h2 className="mb-2 font-semibold">1. Destinatários ({sel.size} selecionados)</h2>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={users.length > 0 && sel.size === users.length} onChange={(e) => setSel(e.target.checked ? new Set(users.map((u) => u.id)) : new Set())} />Selecionar todos os ativos</label>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">{users.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.has(u.id)} onChange={() => tog(u.id)} />{u.nome}</label>)}</div></div>
    <div className="card"><h2 className="mb-2 font-semibold">2. Canais</h2>
      <div className="flex gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={em} onChange={(e) => setEm(e.target.checked)} />E-mail</label><label className="flex items-center gap-2"><input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} />WhatsApp</label></div>
      {(em || wa) && <div className="mt-3 border-l-4 border-blue-600 pl-4">
        {em && <label className="lbl"><span>Assunto do e-mail</span><input className="inp" value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Seu contracheque de novembro" /></label>}
        <fieldset className="mb-3"><legend className="mb-1 text-xs text-slate-500">Origem do arquivo</legend>
          <label className="mr-5 inline-flex items-center gap-2 text-sm"><input type="radio" name="origem" checked={origem === "cadastro"} onChange={() => setOrigem("cadastro")} />Usar arquivo anexado no cadastro</label>
          <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="origem" checked={origem === "novo"} onChange={() => setOrigem("novo")} />Enviar novo arquivo</label></fieldset>
        {origem === "novo" ? <label className="lbl"><span>Contracheque (PDF, PNG ou JPEG, até 5 MB)</span><input className="inp" type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
          : semArquivo.length > 0 && <p className="mb-3 text-sm text-red-700 dark:text-red-400">Sem arquivo no cadastro: {semArquivo.join(", ")}.</p>}
        <label className="lbl"><span>Mensagem de acompanhamento</span><textarea className="inp" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
        <button className="btn" onClick={enviar} disabled={busy}>{busy && <Spin />}{busy ? "Enviando…" : "Enviar"}</button></div>}</div>
  </>);
}

const Campo = ({ o, set, k, l, type = "text", ph, req = true }) => <label className="lbl"><span>{l}</span><input className="inp" type={type} required={req} placeholder={ph} autoComplete={type === "password" ? "new-password" : "off"} value={o[k]} onChange={(e) => set({ ...o, [k]: e.target.value })} /></label>;
const MASK = "••••••••••••";

function Credenciais({ toast }) {
  const [smtp, setSmtp] = useState({ host: "", porta: "587", usuario: "", senha: "", remetente: "" });
  const [wa, setWa] = useState({ url: "", instancia: "", token: "" });
  const [salvo, setSalvo] = useState({ smtp: false, whatsapp: false });
  useEffect(() => {
    const carregar = (tipo, set) => api(`/api/credenciais/${tipo}`).then(({ configurado, segredo_definido, ...d }) => { if (configurado) { set((s) => ({ ...s, ...d })); setSalvo((x) => ({ ...x, [tipo]: segredo_definido })); } }).catch((e) => toast(e.message, true));
    carregar("smtp", setSmtp); carregar("whatsapp", setWa);
  }, [toast]);
  const salvar = (tipo, dados, limpar) => async (e) => { e.preventDefault();
    try { await api(`/api/credenciais/${tipo}`, { method: "PUT", body: dados }); toast("Credenciais salvas."); limpar(); setSalvo((x) => ({ ...x, [tipo]: true })); } catch (x) { toast(x.message, true); } };
  return (<>
    <h1 className="text-xl font-semibold">Credenciais</h1><p className="mb-4 text-sm text-slate-500">Senhas e tokens são criptografados no servidor e nunca voltam para a tela. Deixe em branco para manter o valor salvo.</p>
    <form className="card" onSubmit={salvar("smtp", smtp, () => setSmtp((s) => ({ ...s, senha: "" })))}><h2 className="mb-2 font-semibold">E-mail (SMTP)</h2>
      <div className="grid gap-x-4 sm:grid-cols-2"><Campo o={smtp} set={setSmtp} k="host" l="Host SMTP" /><Campo o={smtp} set={setSmtp} k="porta" l="Porta" type="number" /><Campo o={smtp} set={setSmtp} k="usuario" l="Usuário" /><Campo o={smtp} set={setSmtp} k="senha" l={salvo.smtp ? "Senha ou token de app (já salva)" : "Senha ou token de app"} type="password" ph={salvo.smtp ? MASK : ""} req={!salvo.smtp} /><Campo o={smtp} set={setSmtp} k="remetente" l="E-mail remetente" type="email" /></div><button className="btn">Salvar SMTP</button></form>
    <form className="card" onSubmit={salvar("whatsapp", wa, () => setWa((s) => ({ ...s, token: "" })))}><h2 className="mb-2 font-semibold">WhatsApp (Evolution API)</h2>
      <div className="grid gap-x-4 sm:grid-cols-2"><Campo o={wa} set={setWa} k="url" l="URL da API" /><Campo o={wa} set={setWa} k="instancia" l="Instância" /><Campo o={wa} set={setWa} k="token" l={salvo.whatsapp ? "Token da API (já salvo)" : "Token da API"} type="password" ph={salvo.whatsapp ? MASK : ""} req={!salvo.whatsapp} /></div><button className="btn">Salvar WhatsApp</button></form>
  </>);
}

function Auditoria({ toast }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { api("/api/auditoria").then(setRows).catch((e) => toast(e.message, true)); }, [toast]);
  const abrir = async (a, baixar) => {
    const w = baixar ? null : window.open("", "_blank");
    if (!baixar && !w) return toast("O navegador bloqueou a nova aba. Libere pop-ups ou use Baixar.", true);
    try { const url = URL.createObjectURL(await apiBlob(`/api/auditoria/${a.id}/arquivo${baixar ? "?baixar=1" : ""}`));
      if (baixar) { const l = document.createElement("a"); l.href = url; l.download = a.arquivo; l.click(); } else w.location = url;
    } catch (x) { w && w.close(); toast(x.message, true); } };
  return (<>
    <h1 className="text-xl font-semibold">Auditoria</h1><p className="mb-4 text-sm text-slate-500">Quem enviou qual contracheque, por qual canal e quando. Abra o arquivo exatamente como foi enviado.</p>
    <div className="card overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs text-slate-500"><tr>{["Data e hora", "Operador", "Colaborador", "Canal", "Arquivo", "Status", "Ações"].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{rows.map((a) => <tr key={a.id} className="border-t border-slate-200 dark:border-slate-700"><td className="whitespace-nowrap p-2">{new Date(a.quando).toLocaleString("pt-BR")}</td><td className="p-2">{a.operador}</td><td className="p-2">{a.colaborador || a.colaborador_id}</td><td className="p-2">{a.canal}</td><td className="p-2">{a.arquivo}</td><td className="p-2">{a.status}</td>
        <td className="space-x-1 whitespace-nowrap p-2">{a.tem_arquivo ? <><button className="btn-g" onClick={() => abrir(a, false)}>Ver</button><button className="btn-g" onClick={() => abrir(a, true)}>Baixar</button></> : <span className="text-xs text-slate-500">Indisponível</span>}</td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="p-3 text-slate-500">Nenhum envio registrado ainda.</td></tr>}</tbody></table></div>
  </>);
}

const TABS = [["colab", "Colaboradores", Colaboradores], ["envio", "Enviar contracheques", Envio], ["cred", "Credenciais", Credenciais], ["aud", "Auditoria", Auditoria]];
export default function App() {
  const [logged, setLogged] = useState(!!getToken()), [tab, setTab] = useState("colab"), [toast, view] = useToast();
  useEffect(() => { const f = () => setLogged(false); window.addEventListener("logout", f); return () => window.removeEventListener("logout", f); }, []);
  const Cur = TABS.find((t) => t[0] === tab)[2];
  return (<>
    {!logged ? <Login onOk={() => setLogged(true)} toast={toast} /> : <>
      <header className="sticky top-0 z-10 flex items-center border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800"><b className="mr-auto">Contracheques RH</b><button className="btn-g" onClick={() => { setToken(null); setLogged(false); }}>Sair</button></header>
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-800">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined} className={`whitespace-nowrap px-3 py-2.5 text-sm ${tab === k ? "border-b-2 border-blue-600 font-semibold" : "text-slate-500"}`}>{l}</button>)}</nav>
      <main className="mx-auto max-w-5xl px-4 py-5 pb-16"><Cur toast={toast} /></main></>}
    {view}
  </>);
}
