require("dotenv").config();
const express = require("express"), helmet = require("helmet");
const rateLimit = require("express-rate-limit"), bcrypt = require("bcryptjs"), jwt = require("jsonwebtoken");
const multer = require("multer"), nodemailer = require("nodemailer"), crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite"), path = require("path"), fs = require("fs");

// Em hospedagem, DATA_DIR aponta para o disco persistente (banco e arquivos ficam juntos)
const DATA_DIR = process.env.DATA_DIR || __dirname; fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, "portal.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS operadores(id INTEGER PRIMARY KEY, email TEXT UNIQUE, hash TEXT);
CREATE TABLE IF NOT EXISTS colaboradores(id INTEGER PRIMARY KEY, nome TEXT, email TEXT, telefone TEXT, cpf TEXT, cargo TEXT, departamento TEXT, ativo INTEGER DEFAULT 1, excluido INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS credenciais(tipo TEXT PRIMARY KEY, dados TEXT);
CREATE TABLE IF NOT EXISTS auditoria(id INTEGER PRIMARY KEY, quando TEXT, operador TEXT, colaborador_id INTEGER, canal TEXT, arquivo TEXT, status TEXT);
`);

// Migração: colunas do arquivo padrão (ignora se já existirem)
for (const c of ["arquivo_nome TEXT", "arquivo_mime TEXT"]) { try { db.exec("ALTER TABLE colaboradores ADD COLUMN " + c) } catch {} }
for (const c of ["arquivo_ref TEXT", "arquivo_mime TEXT"]) { try { db.exec("ALTER TABLE auditoria ADD COLUMN " + c) } catch {} }

// --- Criptografia AES-256-GCM (chave de 32 bytes em hex no .env) ---
const KEY = Buffer.from(process.env.ENC_KEY, "hex");
if (KEY.length !== 32) throw new Error("ENC_KEY deve ter 64 caracteres hex (32 bytes)");
const enc = (obj) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const d = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]); return [iv, c.getAuthTag(), d].map(b => b.toString("base64")).join(".") };
const dec = (s) => { const [iv, tag, d] = s.split(".").map(x => Buffer.from(x, "base64")), c = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  c.setAuthTag(tag); return JSON.parse(Buffer.concat([c.update(d), c.final()]).toString("utf8")) };

// --- Armazenamento de arquivos: criptografado em disco (storage/<id>.bin), fora da pasta pública ---
const encBuf = (b) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv); const d = Buffer.concat([c.update(b), c.final()]); return Buffer.concat([iv, c.getAuthTag(), d]) };
const decBuf = (b) => { const c = crypto.createDecipheriv("aes-256-gcm", KEY, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28)); return Buffer.concat([c.update(b.subarray(28)), c.final()]) };
const STORE = path.join(DATA_DIR, "storage"); fs.mkdirSync(path.join(STORE, "envios"), { recursive: true });
const arqPath = (id) => path.join(STORE, `${+id}.bin`);
// Guarda uma cópia criptografada do arquivo exatamente como foi enviado; devolve o caminho relativo gravado na auditoria
const guardar = (buf) => { const ref = "envios/" + crypto.randomUUID() + ".bin"; fs.writeFileSync(path.join(STORE, ref), encBuf(buf)); return ref };
// Confere o conteúdo real do arquivo (não confia só no tipo informado pelo navegador)
const tipoReal = (b) => b.subarray(0, 4).toString("latin1") === "%PDF" ? "application/pdf" : b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? "image/png" : b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? "image/jpeg" : null;

const app = express();
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1); // atrás do proxy da hospedagem (limite de requisições por IP real)
app.use(helmet());
app.use(express.json({ limit: "100kb" }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const sendLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, f, cb) => cb(null, ["application/pdf", "image/png", "image/jpeg"].includes(f.mimetype)) });

// JWT vai no header Authorization (não em cookie), então não há CSRF clássico; CORS restrito ao front.
const auth = (req, res, next) => { try { req.op = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), process.env.JWT_SECRET); next() } catch { res.status(401).json({ erro: "Não autenticado" }) } };

app.post("/api/login", authLimiter, (req, res) => {
  const o = db.prepare("SELECT * FROM operadores WHERE email=?").get(req.body.email || "");
  if (!o || !bcrypt.compareSync(req.body.senha || "", o.hash)) return res.status(401).json({ erro: "Credenciais inválidas" });
  res.json({ token: jwt.sign({ id: o.id, email: o.email }, process.env.JWT_SECRET, { expiresIn: "2h" }) });
});

// --- Colaboradores (exclusão lógica; CPF mascarado na resposta) ---
const mask = (c) => c ? "***." + c.slice(3, 6) + "." + c.slice(6, 9) + "-**" : "";
app.get("/api/colaboradores", auth, (req, res) => {
  const q = `%${req.query.q || ""}%`, page = Math.max(1, +req.query.page || 1), per = Math.min(200, +req.query.per || 20);
  const rows = db.prepare("SELECT * FROM colaboradores WHERE excluido=0 AND (nome LIKE ? OR email LIKE ? OR departamento LIKE ?) LIMIT ? OFFSET ?").all(q, q, q, per, (page - 1) * per);
  res.json(rows.map(r => ({ ...r, cpf: mask(r.cpf) })));
});
const campos = ["nome", "email", "telefone", "cpf", "cargo", "departamento", "ativo"];
app.post("/api/colaboradores", auth, (req, res) => {
  const b = req.body; if (!/^\d{11}$/.test(b.cpf || "")) return res.status(400).json({ erro: "CPF inválido" });
  const r = db.prepare(`INSERT INTO colaboradores(${campos}) VALUES(${campos.map(() => "?")})`).run(...campos.map(c => b[c] ?? null));
  res.status(201).json({ id: r.lastInsertRowid });
});
app.get("/api/colaboradores/:id", auth, (req, res) => {
  const u = db.prepare("SELECT * FROM colaboradores WHERE id=? AND excluido=0").get(req.params.id);
  u ? res.json(u) : res.status(404).json({ erro: "Colaborador não encontrado" });
});
app.put("/api/colaboradores/:id", auth, (req, res) => {
  if (!/^\d{11}$/.test(req.body.cpf || "")) return res.status(400).json({ erro: "CPF inválido" });
  db.prepare(`UPDATE colaboradores SET ${campos.map(c => c + "=?")} WHERE id=?`).run(...campos.map(c => req.body[c] ?? null), req.params.id); res.json({ ok: true });
});
app.delete("/api/colaboradores/:id", auth, (req, res) => { db.prepare("UPDATE colaboradores SET excluido=1, ativo=0 WHERE id=?").run(req.params.id); res.json({ ok: true }) });

// --- Arquivo padrão do colaborador ---
app.put("/api/colaboradores/:id/arquivo", auth, upload.single("arquivo"), (req, res) => {
  const f = req.file, u = db.prepare("SELECT id FROM colaboradores WHERE id=? AND excluido=0").get(req.params.id);
  if (!u) return res.status(404).json({ erro: "Colaborador não encontrado" });
  const tipo = f && tipoReal(f.buffer);
  if (!tipo) return res.status(400).json({ erro: "Envie um PDF, PNG ou JPEG válido de até 5 MB" });
  fs.writeFileSync(arqPath(u.id), encBuf(f.buffer));
  db.prepare("UPDATE colaboradores SET arquivo_nome=?, arquivo_mime=? WHERE id=?").run(path.basename(f.originalname), tipo, u.id);
  res.json({ ok: true });
});
app.delete("/api/colaboradores/:id/arquivo", auth, (req, res) => {
  fs.rmSync(arqPath(req.params.id), { force: true });
  db.prepare("UPDATE colaboradores SET arquivo_nome=NULL, arquivo_mime=NULL WHERE id=?").run(req.params.id); res.json({ ok: true });
});

// --- Credenciais criptografadas (nunca devolvidas em texto) ---
app.put("/api/credenciais/:tipo", auth, (req, res) => {
  if (!["smtp", "whatsapp"].includes(req.params.tipo)) return res.status(400).json({ erro: "Tipo inválido" });
  const seg = req.params.tipo === "smtp" ? "senha" : "token", campos = req.params.tipo === "smtp" ? ["host", "porta", "usuario", "senha", "remetente"] : ["url", "instancia", "token"];
  const atual = db.prepare("SELECT dados FROM credenciais WHERE tipo=?").get(req.params.tipo), dados = Object.fromEntries(campos.map((k) => [k, String(req.body[k] ?? "")]));
  if (!dados[seg]) { if (!atual) return res.status(400).json({ erro: "Informe a senha ou o token" }); dados[seg] = dec(atual.dados)[seg]; } // vazio = manter o valor salvo
  db.prepare("INSERT INTO credenciais(tipo,dados) VALUES(?,?) ON CONFLICT(tipo) DO UPDATE SET dados=excluded.dados").run(req.params.tipo, enc(dados)); res.json({ ok: true });
});
app.get("/api/credenciais/:tipo", auth, (req, res) => {
  if (!["smtp", "whatsapp"].includes(req.params.tipo)) return res.status(400).json({ erro: "Tipo inválido" });
  const r = db.prepare("SELECT dados FROM credenciais WHERE tipo=?").get(req.params.tipo);
  if (!r) return res.json({ configurado: false });
  const { senha, token, ...publico } = dec(r.dados); // senha e token nunca saem do servidor
  res.json({ configurado: true, ...publico, segredo_definido: !!(senha || token) });
});
const cred = (t) => { const r = db.prepare("SELECT dados FROM credenciais WHERE tipo=?").get(t); if (!r) throw new Error(`Credenciais de ${t} não configuradas`); return dec(r.dados) };

// --- Envio: multipart com ids[], canais[], origem (cadastro|novo), assunto, mensagem e arquivo (se origem=novo) ---
app.post("/api/envios", auth, sendLimiter, upload.single("arquivo"), async (req, res) => {
  const f = req.file, ids = [].concat(req.body.ids || []), canais = [].concat(req.body.canais || []), origem = req.body.origem === "cadastro" ? "cadastro" : "novo";
  if (!ids.length || !canais.length) return res.status(400).json({ erro: "Selecione destinatários e canais" });
  if (canais.includes("email") && !req.body.assunto) return res.status(400).json({ erro: "Assunto obrigatório para e-mail" });
  const us = ids.map((id) => db.prepare("SELECT * FROM colaboradores WHERE id=? AND ativo=1 AND excluido=0").get(id)).filter(Boolean);
  let novo;
  if (origem === "novo") {
    const tipo = f && tipoReal(f.buffer);
    if (!tipo) return res.status(400).json({ erro: "Anexe um PDF, PNG ou JPEG válido de até 5 MB" });
    novo = { nome: path.basename(f.originalname), mime: tipo, buf: f.buffer };
  } else {
    const faltam = us.filter((u) => !u.arquivo_nome || !fs.existsSync(arqPath(u.id))).map((u) => u.nome);
    if (faltam.length) return res.status(400).json({ erro: "Sem arquivo no cadastro: " + faltam.join(", ") });
  }
  const resultado = [], log = db.prepare("INSERT INTO auditoria(quando,operador,colaborador_id,canal,arquivo,status,arquivo_ref,arquivo_mime) VALUES(?,?,?,?,?,?,?,?)");
  let smtp, tx, wa;
  try { if (canais.includes("email")) { smtp = cred("smtp"); tx = nodemailer.createTransport({ host: smtp.host, port: +smtp.porta, secure: +smtp.porta === 465, auth: { user: smtp.usuario, pass: smtp.senha } }) };
        if (canais.includes("whatsapp")) wa = cred("whatsapp") } catch (e) { return res.status(400).json({ erro: e.message }) }
  const refNovo = novo && guardar(novo.buf);
  for (const u of us) {
    let arq, ref, erroArq;
    try { arq = novo || { nome: u.arquivo_nome, mime: u.arquivo_mime, buf: decBuf(fs.readFileSync(arqPath(u.id))) }; ref = refNovo || guardar(arq.buf) } catch (e) { erroArq = e.message }
    for (const canal of canais) {
      let status = "enviado";
      try {
        if (erroArq) throw new Error(erroArq);
        if (canal === "email") await tx.sendMail({ from: smtp.remetente, to: u.email, subject: req.body.assunto, text: req.body.mensagem || "", attachments: [{ filename: arq.nome, content: arq.buf }] });
        else { const r = await fetch(`${wa.url}/message/sendMedia/${wa.instancia}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: wa.token },
          body: JSON.stringify({ number: u.telefone.replace(/\D/g, ""), mediatype: arq.mime === "application/pdf" ? "document" : "image", mimetype: arq.mime, caption: req.body.mensagem || "", fileName: arq.nome, media: arq.buf.toString("base64") }) });
          if (!r.ok) throw new Error("WhatsApp " + r.status) }
      } catch (e) { status = "falha: " + e.message }
      log.run(new Date().toISOString(), req.op.email, u.id, canal, arq?.nome || u.arquivo_nome || "-", status, ref || null, arq?.mime || null); resultado.push({ colaborador: u.nome, canal, status });
    }
  }
  res.json({ resultado });
});

app.get("/api/auditoria", auth, (_, res) => res.json(db.prepare("SELECT a.id, a.quando, a.operador, a.colaborador_id, c.nome AS colaborador, a.canal, a.arquivo, a.status, (a.arquivo_ref IS NOT NULL) AS tem_arquivo FROM auditoria a LEFT JOIN colaboradores c ON c.id = a.colaborador_id ORDER BY a.id DESC LIMIT 200").all()));
app.get("/api/auditoria/:id/arquivo", auth, (req, res) => {
  const a = db.prepare("SELECT arquivo, arquivo_ref, arquivo_mime FROM auditoria WHERE id=?").get(req.params.id);
  if (!a || !a.arquivo_ref) return res.status(404).json({ erro: "Arquivo não disponível para este envio" });
  const p = path.join(STORE, a.arquivo_ref);
  if (!p.startsWith(path.join(STORE, "envios") + path.sep) || !fs.existsSync(p)) return res.status(404).json({ erro: "Arquivo não encontrado" });
  res.set({ "Content-Type": a.arquivo_mime, "Content-Disposition": `${req.query.baixar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.arquivo)}` });
  res.send(decBuf(fs.readFileSync(p)));
});

// Cria o primeiro operador: node server.js --criar-operador email senha
if (process.argv[2] === "--criar-operador") { db.prepare("INSERT INTO operadores(email,hash) VALUES(?,?)").run(process.argv[3], bcrypt.hashSync(process.argv[4], 12)); console.log("Operador criado."); process.exit() }
// Primeiro acesso em hospedagem sem terminal: cria o operador inicial a partir de ADMIN_EMAIL e ADMIN_SENHA (só se não houver nenhum)
if (process.env.ADMIN_EMAIL && process.env.ADMIN_SENHA && !db.prepare("SELECT 1 FROM operadores LIMIT 1").get()) {
  db.prepare("INSERT INTO operadores(email,hash) VALUES(?,?)").run(process.env.ADMIN_EMAIL, bcrypt.hashSync(process.env.ADMIN_SENHA, 12)); console.log("Operador inicial criado.");
}

// Erros de upload (ex.: arquivo acima de 5 MB) viram JSON legível
app.use((err, req, res, next) => res.status(400).json({ erro: err.code === "LIMIT_FILE_SIZE" ? "Arquivo acima de 5 MB" : "Requisição inválida" }));

// Em produção (npm run build + npm start) a própria API serve o front compilado.
const dist = path.join(__dirname, "dist");
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.use((req, res) => res.sendFile(path.join(dist, "index.html"))); }
app.listen(process.env.PORT || 3001, () => console.log("API no ar"));
