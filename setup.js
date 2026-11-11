const fs = require("fs"), c = require("crypto");
if (fs.existsSync(".env")) { console.log(".env já existe, nada a fazer."); process.exit(); }
const k = (n) => c.randomBytes(n).toString("hex");
fs.writeFileSync(".env", `PORT=3001\nDB_FILE=portal.db\nENC_KEY=${k(32)}\nJWT_SECRET=${k(48)}\n`);
console.log(".env criado com chaves novas.");
