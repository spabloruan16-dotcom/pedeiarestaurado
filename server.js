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
const supabaseUrl = process.env.SUPABASE_URL || "https://irlarzynvelqvihoxtpj.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "sb_publishable_Zm5dduva-m9IenkcqW509Q_t7tBm6Zj";
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

function respondJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function authenticatedUser(request) {
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user.email_confirmed_at ? user : null;
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) {
        reject(new Error("Corpo da requisição excedeu o limite"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function shopDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    merchantId: row.merchant_id,
    publicId: row.public_id,
    name: row.nome,
    type: row.tipo,
    description: row.descricao || "",
    photo: row.foto_url || "",
    cover: row.capa_url || "",
    isOpen: row.esta_aberta,
    delivery: row.aceita_entrega,
    pickup: row.aceita_retirada,
    deliveryMinutes: row.tempo_entrega,
    pickupMinutes: row.tempo_retirada
  };
}

async function loadShopState(shop, merchant, includePrivate) {
  const categoryResult = await subscriptionPool.query(
    "SELECT id, nome, ordem FROM public.categorias WHERE loja_id = $1 ORDER BY ordem, nome",
    [shop.id]
  );
  const productResult = await subscriptionPool.query(
    `SELECT p.id, p.categoria_id, p.nome, p.descricao, p.foto_url, p.preco, p.disponivel, p.opcoes, c.nome AS categoria
     FROM public.produtos p JOIN public.categorias c ON c.id = p.categoria_id
     WHERE p.loja_id = $1 ORDER BY c.ordem, p.created_at`,
    [shop.id]
  );
  const result = {
    shop: shopDto(shop),
    categories: categoryResult.rows.map((row) => row.nome),
    products: productResult.rows.map((row) => ({
      id: row.id,
      name: row.nome,
      category: row.categoria,
      description: row.descricao || "",
      photo: row.foto_url || "",
      price: Number(row.preco),
      available: row.disponivel,
      options: row.opcoes || []
    })),
    delivery: {
      delivery: shop.aceita_entrega,
      pickup: shop.aceita_retirada,
      deliveryMinutes: shop.tempo_entrega,
      pickupMinutes: shop.tempo_retirada
    }
  };

  if (includePrivate) {
    result.merchant = { authUserId: merchant.id, name: merchant.nome, email: merchant.email };
  }
  return result;
}

async function loadMerchantState(user) {
  const merchantResult = await subscriptionPool.query(
    "SELECT id, nome, email, status_assinatura, inicio_assinatura, fim_assinatura FROM public.comerciantes WHERE id = $1",
    [user.id]
  );
  const merchant = merchantResult.rows[0];
  if (!merchant) return null;

  const shopResult = await subscriptionPool.query(
    "SELECT * FROM public.lojas WHERE merchant_id = $1 ORDER BY created_at LIMIT 1",
    [user.id]
  );
  const shop = shopResult.rows[0];
  const subscription = { status_assinatura: merchant.status_assinatura || "pendente", inicio_assinatura: merchant.inicio_assinatura, fim_assinatura: merchant.fim_assinatura };
  if (!shop) return { merchant: { authUserId: merchant.id, name: merchant.nome, email: merchant.email, status_assinatura: subscription.status_assinatura, fim_assinatura: subscription.fim_assinatura }, subscription, shop: null, categories: [], products: [] };
  const loaded = await loadShopState(shop, merchant, true);
  loaded.merchant.status_assinatura = subscription.status_assinatura;
  loaded.merchant.fim_assinatura = subscription.fim_assinatura;
  loaded.subscription = subscription;
  return loaded;
}

async function loadPublicShop(publicId) {
  const shopResult = await subscriptionPool.query(
    "SELECT * FROM public.lojas WHERE public_id = $1 LIMIT 1",
    [publicId]
  );
  const shop = shopResult.rows[0];
  if (!shop) return null;
  return loadShopState(shop, null, false);
}

async function saveMerchantState(user, data) {
  if (!subscriptionPool) throw new Error("PostgreSQL nao configurado");
  if (!data?.merchant || !data?.shop || data.merchant.authUserId !== user.id) {
    throw new Error("Perfil de loja invalido para esta conta");
  }

  const current = await subscriptionPool.query(
    "SELECT status_assinatura, fim_assinatura FROM public.comerciantes WHERE id = $1",
    [user.id]
  );
  if (current.rowCount) {
    const sub = current.rows[0];
    const expires = sub.fim_assinatura ? new Date(sub.fim_assinatura).getTime() : null;
    if (sub.status_assinatura !== "ativa" || (expires !== null && expires < Date.now())) {
      const error = new Error("Acesso suspenso: sua assinatura está pendente ou expirada. Regularize a mensalidade para continuar.");
      error.statusCode = 403;
      throw error;
    }
  }
  const client = await subscriptionPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO public.comerciantes (id, nome, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email, updated_at = NOW()`,
      [user.id, String(data.merchant.name || user.user_metadata?.name || "Comerciante").slice(0, 120), user.email]
    );

    const delivery = data.delivery || {};
    const shopData = data.shop;
    const existingShop = await client.query(
      "SELECT id FROM public.lojas WHERE merchant_id = $1 ORDER BY created_at LIMIT 1 FOR UPDATE",
      [user.id]
    );
    let shopId;
    if (existingShop.rows[0]) {
      shopId = existingShop.rows[0].id;
      await client.query(
        `UPDATE public.lojas SET public_id=$2, nome=$3, tipo=$4, descricao=$5, foto_url=$6,
         esta_aberta=$7, aceita_entrega=$8, aceita_retirada=$9, tempo_entrega=$10, tempo_retirada=$11, updated_at=NOW()
         WHERE id=$1`,
        [shopId, shopData.publicId, shopData.name, shopData.type || "Loja", shopData.description || "", shopData.photo || null,
          shopData.isOpen !== false, delivery.delivery !== false, delivery.pickup !== false,
          Number(delivery.deliveryMinutes || 45), Number(delivery.pickupMinutes || 20)]
      );
    } else {
      const insertedShop = await client.query(
        `INSERT INTO public.lojas (merchant_id, public_id, nome, tipo, descricao, foto_url, esta_aberta,
         aceita_entrega, aceita_retirada, tempo_entrega, tempo_retirada)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [user.id, shopData.publicId, shopData.name, shopData.type || "Loja", shopData.description || "", shopData.photo || null,
          shopData.isOpen !== false, delivery.delivery !== false, delivery.pickup !== false,
          Number(delivery.deliveryMinutes || 45), Number(delivery.pickupMinutes || 20)]
      );
      shopId = insertedShop.rows[0].id;
    }

    const categoryIds = new Map();
    const categoryNames = [...new Set((data.categories || []).map((name) => String(name).trim()).filter(Boolean))];
    for (const [index, name] of categoryNames.entries()) {
      const result = await client.query(
        `INSERT INTO public.categorias (loja_id, nome, ordem) VALUES ($1,$2,$3)
         ON CONFLICT (loja_id, nome) DO UPDATE SET ordem=EXCLUDED.ordem RETURNING id`,
        [shopId, name.slice(0, 100), index]
      );
      categoryIds.set(name, result.rows[0].id);
    }

    const oldProducts = await client.query(
      "SELECT id, categoria_id, nome FROM public.produtos WHERE loja_id = $1",
      [shopId]
    );
    const oldById = new Map(oldProducts.rows.map((row) => [row.id, row]));
    const oldByName = new Map(oldProducts.rows.map((row) => [`${row.categoria_id}:${row.nome.toLowerCase()}`, row]));
    const savedIds = [];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    for (const product of data.products || []) {
      const categoryId = categoryIds.get(String(product.category || "").trim());
      if (!categoryId) continue;
      const existing = uuidPattern.test(String(product.id || "")) && oldById.has(product.id)
        ? oldById.get(product.id)
        : oldByName.get(`${categoryId}:${String(product.name || "").toLowerCase()}`);
      const values = [shopId, categoryId, String(product.name || "Produto").slice(0, 140), String(product.description || ""),
        product.photo || null, Math.max(0, Number(product.price || 0)), product.available !== false, JSON.stringify(Array.isArray(product.options) ? product.options : [])];
      let productId;
      if (existing) {
        const updated = await client.query(
          `UPDATE public.produtos SET categoria_id=$2, nome=$3, descricao=$4, foto_url=$5, preco=$6, disponivel=$7, opcoes=$8::jsonb, updated_at=NOW()
           WHERE id=$9 AND loja_id=$1 RETURNING id`,
          [...values, existing.id]
        );
        productId = updated.rows[0].id;
      } else {
        const inserted = await client.query(
          `INSERT INTO public.produtos (loja_id, categoria_id, nome, descricao, foto_url, preco, disponivel, opcoes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
          values
        );
        productId = inserted.rows[0].id;
      }
      savedIds.push(productId);
    }

    await client.query(
      `UPDATE public.produtos SET disponivel=FALSE, updated_at=NOW()
       WHERE loja_id=$1 AND NOT (id = ANY($2::uuid[]))
       AND EXISTS (SELECT 1 FROM public.itens_do_pedido i WHERE i.produto_id=produtos.id)`,
      [shopId, savedIds]
    );
    await client.query(
      `DELETE FROM public.produtos p WHERE p.loja_id=$1 AND NOT (p.id = ANY($2::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM public.itens_do_pedido i WHERE i.produto_id=p.id)`,
      [shopId, savedIds]
    );
    await client.query(
      `DELETE FROM public.categorias c WHERE c.loja_id=$1 AND NOT (c.nome = ANY($2::text[]))
       AND NOT EXISTS (SELECT 1 FROM public.produtos p WHERE p.categoria_id=c.id)`,
      [shopId, categoryNames]
    );

    await client.query("COMMIT");
    return { shopId, products: savedIds.length, categories: categoryIds.size };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function requireAdmin(request) {
  const user = await authenticatedUser(request);
  if (!user) return { error: "Sessao invalida ou email nao confirmado", status: 401 };
  if (!subscriptionPool) return { error: "Banco de dados indisponivel", status: 503 };
  const result = await subscriptionPool.query(
    "SELECT role FROM public.admin_roles WHERE user_id = $1 LIMIT 1", [user.id]
  );
  if (result.rows[0]?.role !== "admin") return { error: "Acesso restrito ao administrador", status: 403 };
  return { user };
}


async function supportUser(request) {
  const user = await authenticatedUser(request);
  if (!user) return { error: "Sessao invalida ou email nao confirmado", status: 401 };
  if (!subscriptionPool) return { error: "Banco de dados indisponivel", status: 503 };
  return { user };
}
async function userIsAdmin(userId) {
  const r = await subscriptionPool.query("SELECT 1 FROM public.admin_roles WHERE user_id=$1 AND role='admin' LIMIT 1", [userId]);
  return r.rowCount > 0;
}
async function userMerchant(userId) {
  const r = await subscriptionPool.query("SELECT id FROM public.comerciantes WHERE id=$1 LIMIT 1", [userId]);
  return r.rows[0] || null;
}
async function supportMessages(id) {
  const r = await subscriptionPool.query(`SELECT id, atendimento_id, remetente_id, remetente_tipo, conteudo, anexo_url, anexo_nome, anexo_tipo, created_at FROM public.mensagens_atendimento WHERE atendimento_id=$1 ORDER BY created_at ASC`, [id]);
  return r.rows;
}
async function routeSupport(request, response, pathname) {
  const adminPath = pathname.startsWith('/api/admin/support');
  const auth = adminPath ? await requireAdmin(request) : await supportUser(request);
  if (auth.error) return respondJson(response, auth.status, {error: auth.error});
  const user = auth.user;
  const idMatch = pathname.match(/\/([0-9a-f-]{36})\/messages$/i);
  const ticketMatch = adminPath ? pathname.match(/^\/api\/admin\/support\/([0-9a-f-]{36})$/i) : null;
  if (adminPath) {
    if (pathname === '/api/admin/support' && request.method === 'GET') {
      const r = await subscriptionPool.query(`SELECT a.id, a.comerciante_id, a.loja_id, a.tipo, a.assunto, a.status, a.created_at, a.updated_at, c.nome AS comerciante_nome, c.email, l.nome AS loja_nome, (SELECT m.conteudo FROM public.mensagens_atendimento m WHERE m.atendimento_id=a.id ORDER BY m.created_at DESC LIMIT 1) AS ultima_mensagem FROM public.atendimentos a JOIN public.comerciantes c ON c.id=a.comerciante_id LEFT JOIN public.lojas l ON l.id=a.loja_id ORDER BY a.updated_at DESC LIMIT 200`);
      return respondJson(response, 200, {atendimentos:r.rows});
    }
    if (pathname === '/api/admin/support' && request.method === 'POST') {
      const b=await readRequestJson(request); const merchantId=String(b.comerciante_id||''); const assunto=String(b.assunto||'').trim().slice(0,160); const conteudo=String(b.conteudo||'').trim().slice(0,10000); const tipo=['suporte','cobranca','geral'].includes(b.tipo)?b.tipo:'geral';
      if (!merchantId || !assunto || !conteudo) return respondJson(response,400,{error:'Informe comerciante, assunto e mensagem'});
      const mr=await subscriptionPool.query('SELECT id FROM public.comerciantes WHERE id=$1',[merchantId]); if(!mr.rowCount) return respondJson(response,404,{error:'Comerciante nao encontrado'});
      const lr=await subscriptionPool.query('SELECT id FROM public.lojas WHERE merchant_id=$1 ORDER BY created_at LIMIT 1',[merchantId]);
      const c=await subscriptionPool.query(`INSERT INTO public.atendimentos(comerciante_id,loja_id,tipo,assunto,status) VALUES($1,$2,$3,$4,'aguardando_comerciante') RETURNING *`,[merchantId,lr.rows[0]?.id||null,tipo,assunto]);
      await subscriptionPool.query(`INSERT INTO public.mensagens_atendimento(atendimento_id,remetente_id,remetente_tipo,conteudo) VALUES($1,$2,'admin',$3)`,[c.rows[0].id,user.id,conteudo]);
      return respondJson(response,201,{atendimento:c.rows[0]});
    }
    if (ticketMatch && request.method === 'PATCH') {
      const b = await readRequestJson(request);
      const status = String(b.status || '');
      const allowedStatuses = ['novo', 'em_andamento', 'resolvido'];
      if (!allowedStatuses.includes(status)) return respondJson(response, 400, {error:'Status de chamado invalido'});
      const updated = await subscriptionPool.query('UPDATE public.atendimentos SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id,status,updated_at', [status, ticketMatch[1]]);
      if (!updated.rowCount) return respondJson(response, 404, {error:'Atendimento nao encontrado'});
      return respondJson(response, 200, {atendimento:updated.rows[0]});
    }
    if (ticketMatch && request.method === 'DELETE') {
      const deleted = await subscriptionPool.query('DELETE FROM public.atendimentos WHERE id=$1 RETURNING id', [ticketMatch[1]]);
      if (!deleted.rowCount) return respondJson(response, 404, {error:'Atendimento nao encontrado'});
      return respondJson(response, 200, {ok:true});
    }
    if (idMatch && request.method === 'GET') {
      const own=await subscriptionPool.query('SELECT id FROM public.atendimentos WHERE id=$1',[idMatch[1]]); if(!own.rowCount)return respondJson(response,404,{error:'Atendimento nao encontrado'});
      return respondJson(response,200,{mensagens:await supportMessages(idMatch[1])});
    }
    if (idMatch && request.method === 'POST') {
      const b=await readRequestJson(request); const conteudo=String(b.conteudo||'').trim().slice(0,10000); const anexo=String(b.anexo_url||'').slice(0,1000); if(!conteudo&&!anexo)return respondJson(response,400,{error:'Escreva uma mensagem ou anexe um arquivo'});
      const r=await subscriptionPool.query('SELECT id FROM public.atendimentos WHERE id=$1',[idMatch[1]]); if(!r.rowCount)return respondJson(response,404,{error:'Atendimento nao encontrado'});
      const m=await subscriptionPool.query(`INSERT INTO public.mensagens_atendimento(atendimento_id,remetente_id,remetente_tipo,conteudo,anexo_url,anexo_nome,anexo_tipo) VALUES($1,$2,'admin',$3,$4,$5,$6) RETURNING *`,[idMatch[1],user.id,conteudo,anexo||null,String(b.anexo_nome||'').slice(0,255)||null,String(b.anexo_tipo||'').slice(0,120)||null]);
      await subscriptionPool.query(`UPDATE public.atendimentos SET status='aguardando_comerciante',updated_at=NOW() WHERE id=$1`,[idMatch[1]]);
      return respondJson(response,201,{mensagem:m.rows[0]});
    }
  } else {
    const merchant=await userMerchant(user.id); if(!merchant)return respondJson(response,403,{error:'Perfil de comerciante nao encontrado'});
    if(pathname==='/api/support'&&request.method==='GET'){
      const r=await subscriptionPool.query(`SELECT id,comerciante_id,loja_id,tipo,assunto,status,created_at,updated_at,(SELECT m.conteudo FROM public.mensagens_atendimento m WHERE m.atendimento_id=a.id ORDER BY m.created_at DESC LIMIT 1) AS ultima_mensagem FROM public.atendimentos a WHERE comerciante_id=$1 ORDER BY updated_at DESC`,[user.id]); return respondJson(response,200,{atendimentos:r.rows});
    }
    if(pathname==='/api/support'&&request.method==='POST'){
      const b=await readRequestJson(request);const assunto=String(b.assunto||'').trim().slice(0,160);const conteudo=String(b.conteudo||'').trim().slice(0,10000);const tipo=['suporte','cobranca','geral'].includes(b.tipo)?b.tipo:'suporte';if(!assunto||!conteudo)return respondJson(response,400,{error:'Informe assunto e mensagem'});
      const lr=await subscriptionPool.query('SELECT id FROM public.lojas WHERE merchant_id=$1 ORDER BY created_at LIMIT 1',[user.id]);const c=await subscriptionPool.query(`INSERT INTO public.atendimentos(comerciante_id,loja_id,tipo,assunto,status) VALUES($1,$2,$3,$4,'aguardando_admin') RETURNING *`,[user.id,lr.rows[0]?.id||null,tipo,assunto]);await subscriptionPool.query(`INSERT INTO public.mensagens_atendimento(atendimento_id,remetente_id,remetente_tipo,conteudo,anexo_url,anexo_nome,anexo_tipo) VALUES($1,$2,'comerciante',$3,$4,$5,$6)`,[c.rows[0].id,user.id,conteudo,String(b.anexo_url||'').slice(0,1000)||null,String(b.anexo_nome||'').slice(0,255)||null,String(b.anexo_tipo||'').slice(0,120)||null]);return respondJson(response,201,{atendimento:c.rows[0]});
    }
    if(idMatch){const check=await subscriptionPool.query('SELECT id FROM public.atendimentos WHERE id=$1 AND comerciante_id=$2',[idMatch[1],user.id]);if(!check.rowCount)return respondJson(response,404,{error:'Atendimento nao encontrado'});
      if(request.method==='GET')return respondJson(response,200,{mensagens:await supportMessages(idMatch[1])});
      if(request.method==='POST'){const b=await readRequestJson(request);const conteudo=String(b.conteudo||'').trim().slice(0,10000);const anexo=String(b.anexo_url||'').slice(0,1000);if(!conteudo&&!anexo)return respondJson(response,400,{error:'Escreva uma mensagem ou anexe um arquivo'});const m=await subscriptionPool.query(`INSERT INTO public.mensagens_atendimento(atendimento_id,remetente_id,remetente_tipo,conteudo,anexo_url,anexo_nome,anexo_tipo) VALUES($1,$2,'comerciante',$3,$4,$5,$6) RETURNING *`,[idMatch[1],user.id,conteudo,anexo||null,String(b.anexo_nome||'').slice(0,255)||null,String(b.anexo_tipo||'').slice(0,120)||null]);await subscriptionPool.query(`UPDATE public.atendimentos SET status='aguardando_admin',updated_at=NOW() WHERE id=$1`,[idMatch[1]]);return respondJson(response,201,{mensagem:m.rows[0]});}
    }
  }
  response.setHeader('Allow','GET, POST, PATCH, DELETE');return respondJson(response,405,{error:'Metodo nao permitido'});
}

http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/api/admin/support" || /^\/api\/admin\/support\/[0-9a-f-]{36}(?:\/messages)?$/i.test(pathname) || pathname === "/api/support" || /^\/api\/support\/[0-9a-f-]{36}\/messages$/i.test(pathname)) {
    routeSupport(request,response,pathname).catch(error=>{console.error("Falha no atendimento:",error.message);if(!response.headersSent)respondJson(response,500,{error:"Nao foi possivel concluir o atendimento"});}); return;
  }
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

  if (pathname === "/api/admin/session" || pathname === "/api/admin/merchants" || /^\/api\/admin\/merchants\/[0-9a-f-]+\/subscription$/i.test(pathname)) {
    (async () => {
      const auth = await requireAdmin(request);
      if (auth.error) return respondJson(response, auth.status, { error: auth.error });
      if (pathname === "/api/admin/session" && request.method === "GET") {
        return respondJson(response, 200, { isAdmin: true, user: { id: auth.user.id, email: auth.user.email } });
      }
      if (pathname === "/api/admin/merchants" && request.method === "GET") {
        const result = await subscriptionPool.query(
          `SELECT c.id, c.nome, c.email, c.status_assinatura, c.inicio_assinatura, c.fim_assinatura,
                  l.nome AS loja_nome, l.public_id,
                  (SELECT COUNT(*)::int FROM public.pedidos p WHERE p.loja_id = l.id) AS total_pedidos
           FROM public.comerciantes c
           LEFT JOIN LATERAL (SELECT * FROM public.lojas WHERE merchant_id = c.id ORDER BY created_at LIMIT 1) l ON TRUE
           ORDER BY c.created_at DESC`
        );
        return respondJson(response, 200, { merchants: result.rows });
      }
      const match = pathname.match(/^\/api\/admin\/merchants\/([0-9a-f-]+)\/subscription$/i);
      if (match && request.method === "PATCH") {
        const body = await readRequestJson(request);
        const status = String(body.status || "");
        const allowed = ["ativa", "pendente", "expirada", "suspensa"];
        if (!allowed.includes(status)) return respondJson(response, 400, { error: "Status de assinatura invalido" });
        const days = Number(body.days ?? 30);
        if (!Number.isInteger(days) || days < 1 || days > 3650) return respondJson(response, 400, { error: "Prazo deve ser entre 1 e 3650 dias" });
        const result = status === "ativa"
          ? await subscriptionPool.query(`UPDATE public.comerciantes SET status_assinatura=$1, inicio_assinatura=NOW(), fim_assinatura=$2, updated_at=NOW() WHERE id=$3 RETURNING id, nome, email, status_assinatura, fim_assinatura`, [status, new Date(Date.now() + days * 86400000), match[1]])
          : await subscriptionPool.query(`UPDATE public.comerciantes SET status_assinatura=$1, fim_assinatura=NULL, updated_at=NOW() WHERE id=$2 RETURNING id, nome, email, status_assinatura, fim_assinatura`, [status, match[1]]);
        if (!result.rowCount) return respondJson(response, 404, { error: "Comerciante nao encontrado" });
        return respondJson(response, 200, { ok: true, merchant: result.rows[0] });
      }
      response.setHeader("Allow", "GET, PATCH");
      return respondJson(response, 405, { error: "Metodo nao permitido" });
    })().catch((error) => {
      console.error("Falha na rota administrativa:", error.message);
      if (!response.headersSent) respondJson(response, 500, { error: "Nao foi possivel concluir a operacao administrativa" });
    });
    return;
  }

  if (pathname === "/api/merchant-state") {
    (async () => {
      if (!subscriptionPool) return respondJson(response, 503, { error: "Banco de dados indisponivel" });
      const user = await authenticatedUser(request);
      if (!user) return respondJson(response, 401, { error: "Sessao invalida ou email nao confirmado" });

      if (request.method === "GET") {
        const merchantState = await loadMerchantState(user);
        return respondJson(response, 200, merchantState || { merchant: null, shop: null, categories: [], products: [] });
      }

      if (request.method === "PUT") {
        const body = await readRequestJson(request);
        const saved = await saveMerchantState(user, body);
        return respondJson(response, 200, { ok: true, ...saved });
      }

      response.setHeader("Allow", "GET, PUT");
      return respondJson(response, 405, { error: "Metodo nao permitido" });
    })().catch((error) => {
      console.error("Falha ao carregar/salvar perfil do comerciante:", error.message);
      if (!response.headersSent) respondJson(response, error.statusCode || 500, { error: error.message || "Nao foi possivel salvar os dados da loja" });
    });
    return;
  }

  if (pathname === "/api/public-shop") {
    (async () => {
      if (!subscriptionPool) return respondJson(response, 503, { error: "Banco de dados indisponivel" });
      const publicId = url.searchParams.get("loja");
      if (!publicId) return respondJson(response, 400, { error: "Informe o link publico da loja" });
      const shopState = await loadPublicShop(publicId);
      if (!shopState) return respondJson(response, 404, { error: "Loja nao encontrada" });
      const subscriptionResult = await subscriptionPool.query(
        `SELECT c.status_assinatura, c.fim_assinatura
         FROM public.lojas l JOIN public.comerciantes c ON c.id=l.merchant_id
         WHERE l.public_id=$1 LIMIT 1`,
        [publicId]
      );
      const subscription = subscriptionResult.rows[0];
      const expiresAt = subscription?.fim_assinatura ? new Date(subscription.fim_assinatura).getTime() : null;
      const subscriptionIsActive = subscription?.status_assinatura === "ativa" && (!expiresAt || expiresAt >= Date.now());
      if (!subscriptionIsActive) {
        return respondJson(response, 200, {
          shop: shopState.shop,
          categories: [],
          products: [],
          delivery: shopState.delivery,
          subscription: {
            status_assinatura: subscription?.status_assinatura || "pendente",
            fim_assinatura: subscription?.fim_assinatura || null
          }
        });
      }
      return respondJson(response, 200, shopState);
    })().catch((error) => {
      console.error("Falha ao carregar vitrine publica:", error.message);
      if (!response.headersSent) respondJson(response, 503, { error: "Nao foi possivel carregar a loja" });
    });
    return;
  }

  if (pathname === "/api/shop-subscription") {
    const publicId = url.searchParams.get("loja");
    if (!publicId) return respondJson(response, 400, { error: "Informe o link publico da loja" });
    if (!subscriptionPool) return respondJson(response, 503, { error: "Verificacao de assinatura indisponivel" });

    subscriptionPool.query(
      `SELECT c.status_assinatura, c.fim_assinatura
       FROM public.lojas l
       JOIN public.comerciantes c ON c.id = l.merchant_id
       WHERE l.public_id = $1
       LIMIT 1`,
      [publicId]
    ).then(({ rows }) => {
      if (!rows[0]) return respondJson(response, 404, { error: "Loja nao encontrada" });
      const subscription = rows[0];
      return respondJson(response, 200, {
        status_assinatura: subscription?.status_assinatura || "pendente",
        fim_assinatura: subscription?.fim_assinatura || null
      });
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
