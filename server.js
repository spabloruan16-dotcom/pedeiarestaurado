const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();
const { Pool } = require("pg");

const port = Number(process.env.PORT || 4173);
const root = __dirname;
const dataDir = path.join(root, "server");
const stateFile = path.join(dataDir, "data.json");
const subscriptionPool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
}) : null;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function ensureStateFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify({
      merchant: null,
      shop: null,
      categories: [],
      products: [],
      orders: [],
      ratings: [],
      messages: [],
      delivery: { pickup: true, delivery: true, pickupMinutes: 20, deliveryMinutes: 45 },
      printerConfig: {
        mode: "cabo",
        deviceName: "Impressora térmica padrão",
        copies: 1,
        autoPrint: true,
        includeCustomer: true,
        includePhone: true,
        includeAddress: true,
        includeItems: true,
        includeNotes: true,
        includePayment: true,
        includeFooter: true,
        footerText: "Obrigado pela preferência!"
      },
      printers: [{ id: "default", name: "Impressora térmica local", type: "cabo", status: "Conectada", default: true }]
    }, null, 2));
  }
}

function readStateFile() {
  try {
    ensureStateFile();
    const raw = fs.readFileSync(stateFile, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStateFile(data) {
  ensureStateFile();
  fs.writeFileSync(stateFile, JSON.stringify(data, null, 2));
}

http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/api/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: true, service: "pedeia" }));
    return;
  }

  if (pathname === "/api/state") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(readStateFile()));
    return;
  }

  if (pathname === "/api/shop-subscription") {
    const publicId = url.searchParams.get("loja");
    const state = readStateFile();
    if (!publicId || publicId !== state.shop?.publicId) {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Loja nao encontrada" }));
      return;
    }
    if (!subscriptionPool) {
      response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Verificacao de assinatura indisponivel" }));
      return;
    }

    const merchantId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.merchant?.authUserId || "")
      ? state.merchant.authUserId
      : null;
    const email = String(state.merchant?.email || "").trim().toLowerCase() || null;
    subscriptionPool.query(
      `SELECT status_assinatura, fim_assinatura
       FROM public.comerciantes
       WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
          OR ($2::text IS NOT NULL AND lower(email) = $2::text)
       ORDER BY CASE WHEN id = $1::uuid THEN 0 ELSE 1 END
       LIMIT 1`,
      [merchantId, email]
    ).then(({ rows }) => {
      const subscription = rows[0];
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({
        status_assinatura: subscription?.status_assinatura || "pendente",
        fim_assinatura: subscription?.fim_assinatura || null
      }));
    }).catch((error) => {
      console.error("Falha ao verificar assinatura da loja:", error.message);
      if (!response.headersSent) {
        response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "Verificacao de assinatura indisponivel" }));
      }
    });
    return;
  }

  if (pathname === "/api/save-state") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        writeStateFile(parsed);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Estado invalido" }));
      }
    });
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Acesso negado");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Pagina nao encontrada");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  });
}).listen(port, "0.0.0.0", () => {
  ensureStateFile();
  console.log(`PedeIA em http://localhost:${port}`);
});
