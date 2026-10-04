const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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
    cover: row.banner_url || row.capa_url || "",
    themeColor: row.cor_tema || "#b9362b",
    storefront: row.personalizacao_vitrine || {},
    isOpen: row.esta_aberta,
    delivery: row.aceita_entrega,
    pickup: row.aceita_retirada,
    deliveryMinutes: row.tempo_entrega,
    pickupMinutes: row.tempo_retirada,
    serviceNeighborhoods: Array.isArray((row.personalizacao_vitrine||{}).serviceNeighborhoods)?row.personalizacao_vitrine.serviceNeighborhoods:[],
    addressStreet: row.endereco_rua || "", addressNumber: row.endereco_numero || "", addressComplement: row.endereco_complemento || "", addressNeighborhood: row.endereco_bairro || "", addressCity: row.endereco_cidade || "", addressState: row.endereco_estado || "", addressZip: row.endereco_cep || ""
  };
}

async function loadShopState(shop, merchant, includePrivate) {
  const categoryResult = await subscriptionPool.query(
    "SELECT id, nome, ordem FROM public.categorias WHERE loja_id = $1 ORDER BY ordem, nome",
    [shop.id]
  );
  const productResult = await subscriptionPool.query(
    `SELECT p.id, p.categoria_id, p.nome, p.descricao, p.foto_url, p.preco, p.disponivel, p.opcoes, p.destaque, p.etiqueta,
       COALESCE(related.names, ARRAY[c.nome]) AS categorias,
       COALESCE(related.ids, ARRAY[c.id]) AS categoria_ids,
       c.nome AS categoria
     FROM public.produtos p
     JOIN public.categorias c ON c.id = p.categoria_id AND c.loja_id = p.loja_id
     LEFT JOIN LATERAL (
       SELECT array_agg(DISTINCT cat.nome ORDER BY cat.nome) AS names,
              array_agg(DISTINCT cat.id) AS ids
       FROM public.produto_categorias pc
       JOIN public.categorias cat ON cat.id = pc.categoria_id AND cat.loja_id = p.loja_id
       WHERE pc.produto_id = p.id AND pc.loja_id = p.loja_id
     ) related ON TRUE
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
      categories: Array.isArray(row.categorias) && row.categorias.length ? row.categorias : [row.categoria],
      categoryIds: Array.isArray(row.categoria_ids) ? row.categoria_ids : [],
      description: row.descricao || "",
      photo: row.foto_url || "",
      price: Number(row.preco),
      available: row.disponivel,
      options: Array.isArray(row.opcoes) ? row.opcoes : [],
      featured: row.destaque === true,
      label: row.etiqueta || ""
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
  const ordersResult = await subscriptionPool.query(`
    SELECT p.id,p.status,p.endereco,p.tipo_entrega,p.pagamento,p.observacoes,p.total,p.taxa_entrega,p.desconto,p.codigo_cupom,p.previsao_entrega,p.created_at,p.updated_at,
           c.nome AS cliente_nome,c.telefone AS cliente_telefone,
           COALESCE(json_agg(json_build_object('id',i.produto_id,'name',i.produto_nome,'description',i.produto_descricao,'quantity',i.quantidade,'price',i.preco_unitario,'notes',i.observacao,'selections',i.personalizacoes)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items
    FROM public.pedidos p JOIN public.clientes c ON c.id=p.cliente_id
    LEFT JOIN public.itens_do_pedido i ON i.pedido_id=p.id
    WHERE p.loja_id=$1 GROUP BY p.id,c.nome,c.telefone ORDER BY p.created_at DESC LIMIT 300`, [shop.id]);
  loaded.orders = ordersResult.rows.map(o => ({
    id: o.id, customer: o.cliente_nome, phone: o.cliente_telefone || '', address: o.endereco || '',
    payment: o.pagamento, fulfillment: o.tipo_entrega, status: o.status, total: Number(o.total || 0),
    deliveryFee: Number(o.taxa_entrega || 0), discount: Number(o.desconto || 0), couponCode: o.codigo_cupom || '',
    readyAt: o.previsao_entrega ? new Date(o.previsao_entrega).getTime() : Date.now(),
    createdAt: new Date(o.created_at).getTime(), updatedAt: new Date(o.updated_at).getTime(),
    notes: o.observacoes || '', items: o.items.map(i => ({id:i.id,name:i.name,description:i.description||'',quantity:Number(i.quantity),price:Number(i.price),notes:i.notes||'',selections:i.selections||[]}))
  }));
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
         esta_aberta=$7, aceita_entrega=$8, aceita_retirada=$9, tempo_entrega=$10, tempo_retirada=$11, banner_url=$12, cor_tema=$13, personalizacao_vitrine=$14::jsonb, endereco_rua=$15, endereco_numero=$16, endereco_complemento=$17, endereco_bairro=$18, endereco_cidade=$19, endereco_estado=$20, endereco_cep=$21, updated_at=NOW()
         WHERE id=$1`,
        [shopId, shopData.publicId, shopData.name, shopData.type || "Loja", shopData.description || "", shopData.photo || null,
          shopData.isOpen !== false, delivery.delivery !== false, delivery.pickup !== false,
          Number(delivery.deliveryMinutes || 45), Number(delivery.pickupMinutes || 20), shopData.cover || null, shopData.themeColor || "#b9362b", JSON.stringify(shopData.storefront || {}), shopData.addressStreet||null,shopData.addressNumber||null,shopData.addressComplement||null,shopData.addressNeighborhood||null,shopData.addressCity||null,shopData.addressState||null,shopData.addressZip||null]
      );
    } else {
      const insertedShop = await client.query(
        `INSERT INTO public.lojas (merchant_id, public_id, nome, tipo, descricao, foto_url, esta_aberta,
         aceita_entrega, aceita_retirada, tempo_entrega, tempo_retirada, banner_url, cor_tema, personalizacao_vitrine, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado, endereco_cep)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
        [user.id, shopData.publicId, shopData.name, shopData.type || "Loja", shopData.description || "", shopData.photo || null,
          shopData.isOpen !== false, delivery.delivery !== false, delivery.pickup !== false,
          Number(delivery.deliveryMinutes || 45), Number(delivery.pickupMinutes || 20), shopData.cover || null, shopData.themeColor || "#b9362b", JSON.stringify(shopData.storefront || {}), shopData.addressStreet||null,shopData.addressNumber||null,shopData.addressComplement||null,shopData.addressNeighborhood||null,shopData.addressCity||null,shopData.addressState||null,shopData.addressZip||null]
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
      const requestedNames = [...new Set((Array.isArray(product.categories) && product.categories.length ? product.categories : [product.category])
        .map((name) => String(name || "").trim()).filter(Boolean))];
      const requestedCategoryIds = requestedNames.map((name) => categoryIds.get(name)).filter(Boolean);
      const categoryId = requestedCategoryIds[0] || categoryIds.get(String(product.category || "").trim());
      if (!categoryId) continue;
      const existing = uuidPattern.test(String(product.id || "")) && oldById.has(product.id)
        ? oldById.get(product.id)
        : oldByName.get(`${categoryId}:${String(product.name || "").toLowerCase()}`);
      const values = [shopId, categoryId, String(product.name || "Produto").slice(0, 140), String(product.description || ""),
        product.photo || null, Math.max(0, Number(product.price || 0)), product.available !== false, JSON.stringify(Array.isArray(product.options) ? product.options : [])];
      let productId;
      if (existing) {
        const updated = await client.query(
          `UPDATE public.produtos SET categoria_id=$2, nome=$3, descricao=$4, foto_url=$5, preco=$6, disponivel=$7, opcoes=$8::jsonb, destaque=$9, etiqueta=$10, updated_at=NOW()
           WHERE id=$11 AND loja_id=$1 RETURNING id`,
          [...values, product.featured === true, String(product.label || "").slice(0, 32), existing.id]
        );
        productId = updated.rows[0].id;
      } else {
        const inserted = await client.query(
          `INSERT INTO public.produtos (loja_id, categoria_id, nome, descricao, foto_url, preco, disponivel, opcoes, destaque, etiqueta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING id`,
          [...values, product.featured === true, String(product.label || "").slice(0, 32)]
        );
        productId = inserted.rows[0].id;
      }
      savedIds.push(productId);
      const finalCategoryIds = requestedCategoryIds.length ? requestedCategoryIds : [categoryId];
      await client.query("DELETE FROM public.produto_categorias WHERE loja_id=$1 AND produto_id=$2", [shopId, productId]);
      for (const linkedCategoryId of finalCategoryIds) {
        await client.query(
          `INSERT INTO public.produto_categorias (loja_id, produto_id, categoria_id)
           VALUES ($1,$2,$3) ON CONFLICT (produto_id, categoria_id) DO NOTHING`,
          [shopId, productId, linkedCategoryId]
        );
      }
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
       AND NOT EXISTS (SELECT 1 FROM public.produtos p WHERE p.categoria_id=c.id OR EXISTS (
         SELECT 1 FROM public.produto_categorias pc WHERE pc.categoria_id=c.id AND pc.produto_id=p.id
       ))`,
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
  let pathname = url.pathname;

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

  // Endpoint de descoberta de perfil: usuario autenticado recebe isAdmin=false
  // sem acesso a dados administrativos. As demais rotas continuam exigindo requireAdmin.
  if (pathname === "/api/admin/session" && request.method === "GET") {
    (async () => {
      const user = await authenticatedUser(request);
      if (!user) return respondJson(response, 401, { error: "Sessao invalida ou email nao confirmado" });
      if (!subscriptionPool) return respondJson(response, 503, { error: "Banco de dados indisponivel" });
      const result = await subscriptionPool.query(
        "SELECT 1 FROM public.admin_roles WHERE user_id = $1 AND role = 'admin' LIMIT 1", [user.id]
      );
      return respondJson(response, 200, {
        isAdmin: result.rowCount > 0,
        user: { id: user.id, email: user.email }
      });
    })().catch((error) => {
      console.error("Falha ao verificar perfil:", error.message);
      if (!response.headersSent) respondJson(response, 500, { error: "Nao foi possivel verificar o perfil" });
    });
    return;
  }

  if (pathname === "/api/admin/merchants" || /^\/api\/admin\/merchants\/[0-9a-f-]+\/subscription$/i.test(pathname)) {
    (async () => {
      const auth = await requireAdmin(request);
      if (auth.error) return respondJson(response, auth.status, { error: auth.error });
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

  if (pathname === "/api/public-order" && request.method === "POST") {
    (async () => {
      if (!subscriptionPool) return respondJson(response,503,{error:"Banco de dados indisponivel"});
      const body=await readRequestJson(request);
      const publicId=String(body.loja||"").trim();
      const customer=String(body.cliente?.nome||"").trim().slice(0,120);
      const phone=String(body.cliente?.telefone||"").trim().slice(0,40);
      const address=String(body.endereco||"").trim().slice(0,1000);
      const parts=body.endereco_partes&&typeof body.endereco_partes==="object"?body.endereco_partes:{};
      const addressParts=Object.keys(parts).length?JSON.stringify(parts):null;
      const fulfillment=String(body.tipo_entrega||"");
      const payment=String(body.pagamento||"").trim().slice(0,80);
      const items=Array.isArray(body.itens)?body.itens:[];
      if(!publicId||!customer||!phone||!payment||!items.length||items.length>50)return respondJson(response,400,{error:"Confira os dados do cliente e os itens do pedido"});
      if(!["delivery","pickup"].includes(fulfillment))return respondJson(response,400,{error:"Forma de recebimento invalida"});
      if(fulfillment==="delivery"&&!address)return respondJson(response,400,{error:"Informe o endereco de entrega"});
      const shopRes=await subscriptionPool.query(`SELECT l.*,c.status_assinatura,c.fim_assinatura FROM public.lojas l JOIN public.comerciantes c ON c.id=l.merchant_id WHERE l.public_id=$1 LIMIT 1`,[publicId]);
      if(!shopRes.rowCount)return respondJson(response,404,{error:"Loja nao encontrada"});
      const shop=shopRes.rows[0], expires=shop.fim_assinatura?new Date(shop.fim_assinatura).getTime():null;
      if(shop.status_assinatura!=="ativa"||(expires!==null&&expires<Date.now()))return respondJson(response,403,{error:"Esta loja nao esta recebendo pedidos no momento"});
      if(shop.esta_aberta===false)return respondJson(response,409,{error:"A loja esta fechada"});
      if((fulfillment==="delivery"&&!shop.aceita_entrega)||(fulfillment==="pickup"&&!shop.aceita_retirada))return respondJson(response,409,{error:"Esta modalidade nao esta disponivel"});
      const serviceNeighborhoods=Array.isArray((shop.personalizacao_vitrine||{}).serviceNeighborhoods)?shop.personalizacao_vitrine.serviceNeighborhoods:[];
      let deliveryFee=0;
      if(fulfillment==="delivery"){
        const requestedNeighborhood=String(parts.neighborhood||body.bairro_entrega||"").trim();
        const normalizeName=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLocaleLowerCase("pt-BR");
        const match=serviceNeighborhoods.find(item=>normalizeName(typeof item==="string"?item:(item.nome||item.name))===normalizeName(requestedNeighborhood));
        if(!requestedNeighborhood||!match)return respondJson(response,400,{error:"Selecione um bairro cadastrado pela loja para calcular a taxa de entrega"});
        deliveryFee=Math.max(0,Number(typeof match==="string"?0:(match.taxa??match.fee??0))||0);
      }
      const client=await subscriptionPool.connect();let orderId,trackingToken;
      try{
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${shop.id}:${phone}`]);
        let cr=await client.query("SELECT id FROM public.clientes WHERE telefone=$1 ORDER BY created_at LIMIT 1 FOR UPDATE",[phone]);
        let customerId;
        if(cr.rowCount){customerId=cr.rows[0].id;await client.query("UPDATE public.clientes SET nome=$2,endereco=$3,updated_at=NOW() WHERE id=$1",[customerId,customer,address||null]);}
        else {const c=await client.query("INSERT INTO public.clientes(nome,telefone,endereco) VALUES($1,$2,$3) RETURNING id",[customer,phone,address||null]);customerId=c.rows[0].id;}
        let subtotal=0;const verified=[];
        for(const item of items){
          const productId=String(item.produto_id||"");const qty=Number(item.quantidade);
          if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)||!Number.isInteger(qty)||qty<1||qty>50)throw Object.assign(new Error("Produto ou quantidade invalida"),{statusCode:400});
          const pr=await client.query("SELECT id,nome,descricao,preco,disponivel,opcoes FROM public.produtos WHERE id=$1 AND loja_id=$2",[productId,shop.id]);
          if(!pr.rowCount||!pr.rows[0].disponivel)throw Object.assign(new Error("Um produto nao esta mais disponivel"),{statusCode:409});
          const product=pr.rows[0], selections=Array.isArray(item.personalizacoes)?item.personalizacoes:[];let unit=Number(product.preco);const accepted=[];
          const groups=Array.isArray(product.opcoes)?product.opcoes:[];
          for(const sel of selections){const group=groups.find(g=>String(g.title||g.key)===String(sel.group));const choice=group?.choices?.find(c=>String(c.name)===String(sel.name));if(!choice)throw Object.assign(new Error("Uma personalizacao selecionada nao e valida"),{statusCode:400});const price=Number(choice.price||0);unit+=price;accepted.push({group:String(group.title||group.key),name:String(choice.name),price});}
          for(const group of groups){const selected=accepted.filter(x=>x.group===String(group.title||group.key)).length;const min=Number(group.min||0),max=Number(group.max||1);if(selected<min||selected>max)throw Object.assign(new Error(`Revise as opcoes de ${product.nome}`),{statusCode:400});}
          const lineTotal=unit*qty;subtotal+=lineTotal;verified.push({product,qty,unit,lineTotal,notes:String(item.observacao||"").trim().slice(0,500),selections:accepted});
        }
        const fee=deliveryFee,discount=0,total=subtotal+fee-discount;
        const status="Aguardando",eta=new Date(Date.now()+Math.max(10,Number(fulfillment==="delivery"?shop.tempo_entrega:shop.tempo_retirada)||30)*60000);
        trackingToken=crypto.randomBytes(32).toString("base64url");const tokenHash=crypto.createHash("sha256").update(trackingToken).digest("hex");
        const inserted=await client.query(`INSERT INTO public.pedidos(loja_id,cliente_id,tipo_entrega,endereco,endereco_partes,pagamento,observacoes,total,taxa_entrega,status,previsao_entrega,public_token_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12) RETURNING id,created_at`,[shop.id,customerId,fulfillment,address||null,addressParts,payment,String(body.observacoes||"").slice(0,1000),total,fee,status,eta,tokenHash]);orderId=inserted.rows[0].id;
        for(const item of verified){await client.query(`INSERT INTO public.itens_do_pedido(pedido_id,produto_id,produto_nome,produto_descricao,quantidade,preco_unitario,observacao,personalizacoes,preco_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,[orderId,item.product.id,item.product.nome,item.product.descricao||"",item.qty,item.unit,item.notes||null,JSON.stringify(item.selections),item.lineTotal]);}
        await client.query("COMMIT");return respondJson(response,201,{pedido:{id:orderId,status,total,taxa_entrega:fee,created_at:inserted.rows[0].created_at,previsao_entrega:eta},tracking_token:trackingToken});
      }catch(e){await client.query("ROLLBACK");return respondJson(response,e.statusCode||400,{error:e.message||"Nao foi possivel registrar o pedido"});}finally{client.release();}
    })().catch(e=>{console.error("Falha ao criar pedido publico:",e.message);if(!response.headersSent)respondJson(response,500,{error:"Nao foi possivel registrar o pedido"});});return;
  }
  if (pathname === "/api/order-track" && request.method === "GET") {
    (async()=>{if(!subscriptionPool)return respondJson(response,503,{error:"Banco indisponivel"});const token=String(url.searchParams.get("token")||"");if(token.length<30)return respondJson(response,401,{error:"Codigo de acompanhamento invalido"});const hash=crypto.createHash("sha256").update(token).digest("hex");const r=await subscriptionPool.query(`SELECT p.id,p.status,p.tipo_entrega,p.previsao_entrega,p.created_at,p.updated_at,l.nome AS loja_nome, NULLIF(concat_ws(', ', NULLIF(l.endereco_rua,''), NULLIF(l.endereco_numero,''), NULLIF(l.endereco_complemento,''), NULLIF(l.endereco_bairro,''), NULLIF(l.endereco_cidade,''), NULLIF(l.endereco_estado,''), NULLIF(l.endereco_cep,'')), '') AS loja_endereco, e.ultima_latitude,e.ultima_longitude,e.localizacao_atualizada_em FROM public.pedidos p JOIN public.lojas l ON l.id=p.loja_id LEFT JOIN public.entregadores e ON e.id=p.entregador_id WHERE p.public_token_hash=$1 LIMIT 1`,[hash]);if(!r.rowCount)return respondJson(response,404,{error:"Pedido nao encontrado"});const o=r.rows[0];return respondJson(response,200,{pedido:{id:o.id,status:o.status,tipo_entrega:o.tipo_entrega,previsao_entrega:o.previsao_entrega,created_at:o.created_at,updated_at:o.updated_at,loja_nome:o.loja_nome,loja_endereco:o.loja_endereco,localizacao:o.ultima_latitude!==null&&o.ultima_longitude!==null?{latitude:Number(o.ultima_latitude),longitude:Number(o.ultima_longitude),at:o.localizacao_atualizada_em}:null}});})().catch(e=>{console.error("Falha rastreio pedido:",e.message);if(!response.headersSent)respondJson(response,500,{error:"Nao foi possivel consultar o pedido"});});return;
  }

  if (pathname === "/api/merchant/orders" && ["GET","PATCH"].includes(request.method)) {
    (async()=>{
      if(!subscriptionPool)return respondJson(response,503,{error:"Banco de dados indisponivel"});
      const user=await authenticatedUser(request);if(!user)return respondJson(response,401,{error:"Sessao invalida"});
      const mr=await subscriptionPool.query("SELECT status_assinatura,fim_assinatura FROM public.comerciantes WHERE id=$1",[user.id]);if(!mr.rowCount)return respondJson(response,403,{error:"Perfil de comerciante nao encontrado"});
      const sub=mr.rows[0];if(sub.status_assinatura!=="ativa"||(sub.fim_assinatura&&new Date(sub.fim_assinatura).getTime()<Date.now()))return respondJson(response,403,{error:"Assinatura inativa"});
      const lr=await subscriptionPool.query("SELECT id FROM public.lojas WHERE merchant_id=$1 ORDER BY created_at LIMIT 1",[user.id]);if(!lr.rowCount)return respondJson(response,404,{error:"Loja nao encontrada"});const shopId=lr.rows[0].id;
      if(request.method==="GET"){const r=await subscriptionPool.query("SELECT id,status,endereco,tipo_entrega,created_at FROM public.pedidos WHERE loja_id=$1 ORDER BY created_at DESC LIMIT 300",[shopId]);return respondJson(response,200,{pedidos:r.rows});}
      const b=await readRequestJson(request),orderId=String(b.pedido_id||""),status=String(b.status||"");const allowed=["Aguardando","Em preparo","Pronto","Saiu para entrega","Em rota","Entregue","Cancelado","Cancelada","Problema na entrega"];
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)||!allowed.includes(status))return respondJson(response,400,{error:"Pedido ou status invalido"});
      const client=await subscriptionPool.connect();try{await client.query("BEGIN");const r=await client.query("UPDATE public.pedidos SET status=$3,updated_at=NOW(),confirmado_em=CASE WHEN $4::text='Entregue' THEN NOW() ELSE confirmado_em END WHERE id=$1 AND loja_id=$2 RETURNING id,status,updated_at,entregador_id,taxa_entrega,endereco,tipo_entrega",[orderId,shopId,status,status]);if(!r.rowCount){await client.query("ROLLBACK");return respondJson(response,404,{error:"Pedido nao encontrado"});}const p=r.rows[0];if(status==='Entregue'&&p.tipo_entrega==='delivery'&&p.entregador_id){await client.query(`INSERT INTO public.historico_entregas(loja_id,pedido_id,entregador_id,taxa_recebida,endereco,concluida_em) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(pedido_id) DO NOTHING`,[shopId,p.id,p.entregador_id,Number(p.taxa_entrega||0),p.endereco]);}await client.query("COMMIT");return respondJson(response,200,{pedido:{id:p.id,status:p.status,updated_at:p.updated_at}});}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    })().catch(e=>{console.error("Falha pedidos comerciante:",e.message);if(!response.headersSent)respondJson(response,500,{error:"Nao foi possivel atualizar o pedido"});});return;
  }

  if (pathname.startsWith("/api/merchant/couriers")) {
    (async () => {
      if (!subscriptionPool) return respondJson(response, 503, { error: "Banco de dados indisponivel" });
      const user = await authenticatedUser(request);
      if (!user) return respondJson(response, 401, { error: "Sessao invalida" });
      const merchant = await subscriptionPool.query("SELECT id,status_assinatura,fim_assinatura FROM public.comerciantes WHERE id=$1", [user.id]);
      if (!merchant.rowCount) return respondJson(response, 403, { error: "Perfil de comerciante nao encontrado" });
      const sub = merchant.rows[0];
      if (sub.status_assinatura !== "ativa" || (sub.fim_assinatura && new Date(sub.fim_assinatura).getTime() < Date.now())) return respondJson(response, 403, { error: "Assinatura inativa" });
      const shopRes = await subscriptionPool.query("SELECT id FROM public.lojas WHERE merchant_id=$1 ORDER BY created_at LIMIT 1", [user.id]);
      if (!shopRes.rowCount) return respondJson(response, 404, { error: "Cadastre sua loja primeiro" });
      const shopId = shopRes.rows[0].id;
      const routeMatch = pathname.match(/^\/api\/merchant\/couriers\/([0-9a-f-]{36})$/i);
      if (pathname === "/api/merchant/couriers/history" && request.method === "GET") {
        const courierId=String(url.searchParams.get("entregador_id")||"");
        if(!/^[0-9a-f-]{36}$/i.test(courierId))return respondJson(response,400,{error:"Entregador invalido"});
        const rows=await subscriptionPool.query(`SELECT h.id,h.pedido_id,h.taxa_recebida,h.endereco,h.concluida_em,e.nome AS entregador_nome FROM public.historico_entregas h JOIN public.entregadores e ON e.id=h.entregador_id WHERE h.loja_id=$1 AND h.entregador_id=$2 ORDER BY h.concluida_em DESC LIMIT 300`,[shopId,courierId]);
        return respondJson(response,200,{historico:rows.rows});
      }
      if (pathname === "/api/merchant/couriers" && request.method === "GET") {
        const rows = await subscriptionPool.query(`SELECT e.id,e.nome,e.telefone,e.veiculo,e.ativo,e.created_at,
          (SELECT count(*)::int FROM public.pedidos p WHERE p.entregador_id=e.id AND p.status NOT IN ('Entregue','Cancelado','Cancelada')) AS pedidos_ativos,
          (SELECT count(*)::int FROM public.historico_entregas h WHERE h.entregador_id=e.id AND (h.concluida_em AT TIME ZONE 'America/Recife')::date=(NOW() AT TIME ZONE 'America/Recife')::date) AS entregas_hoje,
          (SELECT COALESCE(sum(h.taxa_recebida),0)::numeric(12,2) FROM public.historico_entregas h WHERE h.entregador_id=e.id AND (h.concluida_em AT TIME ZONE 'America/Recife')::date=(NOW() AT TIME ZONE 'America/Recife')::date) AS ganhos_hoje
          FROM public.entregadores e WHERE e.loja_id=$1 ORDER BY e.created_at DESC`, [shopId]);
        return respondJson(response, 200, { entregadores: rows.rows });
      }
      if (pathname === "/api/merchant/couriers" && request.method === "POST") {
        const body = await readRequestJson(request);
        const nome = String(body.nome || "").trim().slice(0,120), telefone=String(body.telefone||"").trim().slice(0,40), veiculo=String(body.veiculo||"").trim().slice(0,80);
        if (!nome) return respondJson(response,400,{error:"Informe o nome do entregador"});
        const token=crypto.randomBytes(32).toString("base64url"), tokenHash=crypto.createHash("sha256").update(token).digest("hex");
        const inserted=await subscriptionPool.query(`INSERT INTO public.entregadores(loja_id,nome,telefone,veiculo,token_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,nome,telefone,veiculo,ativo,created_at`,[shopId,nome,telefone,veiculo,tokenHash]);
        return respondJson(response,201,{entregador:inserted.rows[0],token});
      }
      if (routeMatch && request.method === "PATCH") {
        const body=await readRequestJson(request), ativo=body.ativo===true;
        const updated=await subscriptionPool.query("UPDATE public.entregadores SET ativo=$3,updated_at=NOW() WHERE id=$1 AND loja_id=$2 RETURNING id,nome,telefone,veiculo,ativo",[routeMatch[1],shopId,ativo]);
        return updated.rowCount?respondJson(response,200,{entregador:updated.rows[0]}):respondJson(response,404,{error:"Entregador nao encontrado"});
      }
      if (routeMatch && request.method === "DELETE") {
        const hist=await subscriptionPool.query("SELECT 1 FROM public.historico_entregas WHERE entregador_id=$1 LIMIT 1",[routeMatch[1]]);
        if(hist.rowCount){const archived=await subscriptionPool.query("UPDATE public.entregadores SET ativo=false,updated_at=NOW() WHERE id=$1 AND loja_id=$2 RETURNING id",[routeMatch[1],shopId]);return archived.rowCount?respondJson(response,200,{ok:true,archived:true}):respondJson(response,404,{error:"Entregador nao encontrado"});}
        await subscriptionPool.query("UPDATE public.pedidos SET entregador_id=NULL WHERE entregador_id=$1 AND loja_id=$2",[routeMatch[1],shopId]);
        const deleted=await subscriptionPool.query("DELETE FROM public.entregadores WHERE id=$1 AND loja_id=$2 RETURNING id",[routeMatch[1],shopId]);
        return deleted.rowCount?respondJson(response,200,{ok:true}):respondJson(response,404,{error:"Entregador nao encontrado"});
      }
      const assign=pathname.match(/^\/api\/merchant\/couriers\/([0-9a-f-]{36})\/assign$/i);
      if(assign && request.method==="POST"){
        const body=await readRequestJson(request), orderId=String(body.pedido_id||"");
        if(!/^[0-9a-f-]{36}$/i.test(orderId))return respondJson(response,400,{error:"ID de pedido invalido"});
        const c=await subscriptionPool.query("SELECT id FROM public.entregadores WHERE id=$1 AND loja_id=$2 AND ativo=true",[assign[1],shopId]);
        if(!c.rowCount)return respondJson(response,404,{error:"Entregador ativo nao encontrado"});
        const order=await subscriptionPool.query("UPDATE public.pedidos SET entregador_id=$1,updated_at=NOW() WHERE id=$2 AND loja_id=$3 AND status NOT IN ('Entregue','Cancelado','Cancelada') RETURNING id,status,endereco",[assign[1],orderId,shopId]);
        return order.rowCount?respondJson(response,200,{pedido:order.rows[0]}):respondJson(response,404,{error:"Pedido nao encontrado ou encerrado"});
      }
      response.setHeader("Allow","GET, POST, PATCH, DELETE");return respondJson(response,405,{error:"Metodo nao permitido"});
    })().catch(error=>{console.error("Falha central entregadores:",error.message);if(!response.headersSent)respondJson(response,500,{error:"Nao foi possivel concluir a operacao de entregadores"});});
    return;
  }
  if (pathname === "/api/courier" && ["GET","PATCH"].includes(request.method)) {
    (async()=>{
      if(!subscriptionPool)return respondJson(response,503,{error:"Banco indisponivel"});
      const token=String(url.searchParams.get("token")||"");
      if(token.length<30)return respondJson(response,401,{error:"Link invalido ou expirado"});
      const hash=crypto.createHash("sha256").update(token).digest("hex");
      const found=await subscriptionPool.query(`SELECT e.id,e.nome,e.loja_id,e.ativo,l.nome AS loja_nome FROM public.entregadores e JOIN public.lojas l ON l.id=e.loja_id WHERE e.token_hash=$1 LIMIT 1`,[hash]);
      const courier=found.rows[0];if(!courier||!courier.ativo)return respondJson(response,403,{error:"Acesso do entregador desativado"});
      if(request.method==="GET"){
        const orders=await subscriptionPool.query(`SELECT p.id,p.status,p.endereco,p.endereco_partes,p.tipo_entrega,p.previsao_entrega,p.created_at,
          CASE WHEN p.entregador_id=$1 THEN 'assigned' ELSE 'available' END AS courier_assignment,
          c.nome AS cliente_nome,c.telefone AS cliente_telefone,
          COALESCE(json_agg(json_build_object('nome',i.produto_nome,'quantidade',i.quantidade,'observacao',i.observacao)) FILTER(WHERE i.id IS NOT NULL),'[]') AS itens
          FROM public.pedidos p JOIN public.clientes c ON c.id=p.cliente_id LEFT JOIN public.itens_do_pedido i ON i.pedido_id=p.id
          WHERE p.tipo_entrega='delivery' AND p.status IN ('Pronto','Saiu para entrega','Em rota')
            AND (p.entregador_id=$1 OR p.entregador_id IS NULL)
          GROUP BY p.id,c.nome,c.telefone ORDER BY CASE WHEN p.entregador_id=$1 THEN 0 ELSE 1 END,p.created_at`,[courier.id]);
        const history=await subscriptionPool.query(`SELECT h.id,h.pedido_id,h.taxa_recebida,h.endereco,h.concluida_em FROM public.historico_entregas h WHERE h.entregador_id=$1 AND h.loja_id=$2 ORDER BY h.concluida_em DESC LIMIT 300`,[courier.id,courier.loja_id]);
        const today=await subscriptionPool.query(`SELECT count(*)::int AS quantidade,COALESCE(sum(taxa_recebida),0)::numeric(12,2) AS valor FROM public.historico_entregas WHERE entregador_id=$1 AND (concluida_em AT TIME ZONE 'America/Recife')::date=(NOW() AT TIME ZONE 'America/Recife')::date`,[courier.id]);
        return respondJson(response,200,{entregador:{nome:courier.nome,loja:courier.loja_nome},pedidos:orders.rows,historico:history.rows,resumo_hoje:today.rows[0]});
      }
      const body=await readRequestJson(request), allowed=["Saiu para entrega","Em rota","Entregue","Problema na entrega"];
      if(body.acao==="aceitar"){
        const orderId=String(body.pedido_id||'');
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId))return respondJson(response,400,{error:"ID de pedido invalido"});
        const accepted=await subscriptionPool.query(`UPDATE public.pedidos SET entregador_id=$1,updated_at=NOW()
          WHERE id=$2 AND loja_id=$3 AND tipo_entrega='delivery' AND entregador_id IS NULL
          AND status IN ('Pronto','Saiu para entrega') RETURNING id,status`,[courier.id,orderId,courier.loja_id]);
        if(!accepted.rowCount)return respondJson(response,409,{error:"Este pedido não está mais disponível para aceite. Atualize a lista."});
        return respondJson(response,200,{ok:true,pedido:accepted.rows[0]});
      }
      if(body.status&&!allowed.includes(body.status))return respondJson(response,400,{error:"Status nao permitido"});
      const client=await subscriptionPool.connect();try{await client.query("BEGIN");
        if(body.latitude!==undefined&&body.longitude!==undefined){const lat=Number(body.latitude),lon=Number(body.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error("Coordenadas invalidas");await client.query("UPDATE public.entregadores SET ultima_latitude=$2,ultima_longitude=$3,localizacao_atualizada_em=NOW(),updated_at=NOW() WHERE id=$1",[courier.id,lat,lon]);}
        if(body.pedido_id&&body.status){const result=await client.query("UPDATE public.pedidos SET status=$3::text,updated_at=NOW(),confirmado_em=CASE WHEN $3::text='Entregue' THEN NOW() ELSE confirmado_em END WHERE id=$1 AND entregador_id=$2 AND loja_id=$4 AND tipo_entrega='delivery' AND status NOT IN ('Entregue','Cancelado','Cancelada') RETURNING id,loja_id,taxa_entrega,endereco",[body.pedido_id,courier.id,body.status,courier.loja_id]);if(!result.rowCount)throw new Error("Pedido nao atribuido ou ja encerrado");if(body.status==='Entregue'){const p=result.rows[0];await client.query(`INSERT INTO public.historico_entregas(loja_id,pedido_id,entregador_id,taxa_recebida,endereco,concluida_em) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(pedido_id) DO NOTHING`,[p.loja_id,p.id,courier.id,Number(p.taxa_entrega||0),p.endereco]);}}
        await client.query("COMMIT");return respondJson(response,200,{ok:true});
      }catch(e){await client.query("ROLLBACK");return respondJson(response,400,{error:e.message});}finally{client.release();}
    })().catch(error=>{console.error("Falha portal entregador:",error.message);if(!response.headersSent)respondJson(response,500,{error:"Nao foi possivel carregar as entregas"});});return;
  }
  if (pathname === "/motoboy" || pathname === "/motoboy/") { pathname="/motoboy.html"; }
  if (pathname === "/acompanhar" || pathname === "/acompanhar/") { pathname="/acompanhar.html"; }
  if (pathname === "/api/geocode-neighborhoods" && request.method === "POST") {
    (async()=>{
      if(!subscriptionPool)return respondJson(response,503,{error:"Banco indisponivel"});
      const user=await authenticatedUser(request);if(!user)return respondJson(response,401,{error:"Sessao invalida"});
      const body=await readRequestJson(request),city=String(body.cidade||"").trim().slice(0,100),state=String(body.estado||"").trim().slice(0,80);
      if(!city||!state)return respondJson(response,400,{error:"Informe cidade e estado para buscar sugestoes"});
      const merchant=await subscriptionPool.query("SELECT status_assinatura,fim_assinatura FROM public.comerciantes WHERE id=$1",[user.id]);
      if(!merchant.rowCount||merchant.rows[0].status_assinatura!=="ativa"||(merchant.rows[0].fim_assinatura&&new Date(merchant.rows[0].fim_assinatura)<new Date()))return respondJson(response,403,{error:"Assinatura inativa"});
      const key=process.env.ORS_API_KEY;if(!key)return respondJson(response,503,{error:"Configure ORS_API_KEY no servidor Render"});
      const endpoint=new URL("https://api.openrouteservice.org/geocode/search");endpoint.searchParams.set("text",`${city}, ${state}, Brasil`);endpoint.searchParams.set("boundary.country","BR");endpoint.searchParams.set("layers","neighbourhood,borough");endpoint.searchParams.set("size","30");endpoint.searchParams.set("api_key",key);
      const upstream=await fetch(endpoint,{signal:AbortSignal.timeout(12000)});if(!upstream.ok)return respondJson(response,502,{error:"O serviço geográfico não retornou sugestões. Você pode cadastrar os bairros manualmente."});
      const data=await upstream.json(),seen=new Set(),suggestions=[];for(const f of data.features||[]){const props=f.properties||{},name=String(props.name||props.locality||"").trim(),layer=String(props.layer||"");if(!name||!(["neighbourhood","borough"].includes(layer)))continue;const k=name.toLocaleLowerCase("pt-BR");if(!seen.has(k)){seen.add(k);suggestions.push({nome:name,tipo:layer});}}
      return respondJson(response,200,{sugestoes:suggestions.slice(0,30),aviso:suggestions.length?"Revise as sugestões: a cobertura do mapa pode ser incompleta.":"Nenhum bairro encontrado. Você pode adicionar manualmente."});
    })().catch(e=>{console.error("Falha sugestoes geograficas:",e.message);if(!response.headersSent)respondJson(response,502,{error:"Não foi possível buscar bairros agora. Cadastre-os manualmente."});});return;
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
      return respondJson(response, 200, {
        ...shopState,
        subscription: {
          status_assinatura: subscription?.status_assinatura || "pendente",
          fim_assinatura: subscription?.fim_assinatura || null
        }
      });
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
