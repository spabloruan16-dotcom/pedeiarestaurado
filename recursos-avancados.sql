-- PedeIA: extensao incremental para vitrine, pedidos, estoque, financeiro e CRM.
-- Compatível com tabelas existentes em português. Não apaga dados nem tabelas.
BEGIN;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS opcoes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS destaque boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS etiqueta text,
  ADD COLUMN IF NOT EXISTS custo numeric(10,2),
  ADD COLUMN IF NOT EXISTS estoque_controlado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estoque_atual numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estoque_minimo numeric(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.itens_do_pedido
  ADD COLUMN IF NOT EXISTS personalizacoes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS preco_total numeric(10,2);
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS taxa_entrega numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS codigo_cupom text,
  ADD COLUMN IF NOT EXISTS previsao_entrega timestamptz,
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'vitrine';
ALTER TABLE public.lojas
  ADD COLUMN IF NOT EXISTS banner_url text,
  ADD COLUMN IF NOT EXISTS cor_tema text,
  ADD COLUMN IF NOT EXISTS valor_minimo numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxa_entrega numeric(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.banners_promocionais (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
 titulo varchar(140) NOT NULL, descricao text, imagem_url text, link_url text,
 ativo boolean NOT NULL DEFAULT true, ordem smallint NOT NULL DEFAULT 0,
 inicia_em timestamptz, termina_em timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cupons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
 codigo varchar(40) NOT NULL, tipo varchar(20) NOT NULL CHECK(tipo IN ('percentual','valor','entrega_gratis')),
 valor numeric(10,2) NOT NULL DEFAULT 0 CHECK(valor >= 0), pedido_minimo numeric(10,2) NOT NULL DEFAULT 0,
 limite_usos integer, usos integer NOT NULL DEFAULT 0, ativo boolean NOT NULL DEFAULT true,
 inicia_em timestamptz, termina_em timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(loja_id,codigo)
);
CREATE TABLE IF NOT EXISTS public.enderecos_clientes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
 rotulo varchar(60) DEFAULT 'Casa', endereco text NOT NULL, complemento text, referencia text,
 principal boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ingredientes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
 nome varchar(140) NOT NULL, unidade varchar(20) NOT NULL DEFAULT 'un', quantidade numeric(12,3) NOT NULL DEFAULT 0,
 estoque_minimo numeric(12,3) NOT NULL DEFAULT 0, custo_unitario numeric(12,4) NOT NULL DEFAULT 0,
 ativo boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(loja_id,nome)
);
CREATE TABLE IF NOT EXISTS public.fichas_tecnicas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
 ingrediente_id uuid NOT NULL REFERENCES public.ingredientes(id) ON DELETE CASCADE,
 quantidade numeric(12,3) NOT NULL CHECK(quantidade > 0), UNIQUE(produto_id,ingrediente_id)
);
CREATE TABLE IF NOT EXISTS public.movimentacoes_estoque (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
 ingrediente_id uuid REFERENCES public.ingredientes(id) ON DELETE SET NULL,
 produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
 tipo varchar(20) NOT NULL CHECK(tipo IN ('entrada','saida','desperdicio','ajuste')),
 quantidade numeric(12,3) NOT NULL CHECK(quantidade > 0), motivo text, pedido_id uuid REFERENCES public.pedidos(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.despesas_financeiras (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
 descricao varchar(180) NOT NULL, categoria varchar(80), valor numeric(12,2) NOT NULL CHECK(valor >= 0),
 vencimento date, pago_em timestamptz, status varchar(20) NOT NULL DEFAULT 'pendente', observacoes text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fidelidade_config (
 loja_id uuid PRIMARY KEY REFERENCES public.lojas(id) ON DELETE CASCADE,
 ativo boolean NOT NULL DEFAULT false, pontos_por_real numeric(8,3) NOT NULL DEFAULT 1,
 valor_ponto numeric(10,4) NOT NULL DEFAULT 0.01, cashback_percentual numeric(5,2) NOT NULL DEFAULT 0,
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.pontos_clientes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
 cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
 pedido_id uuid REFERENCES public.pedidos(id) ON DELETE SET NULL,
 pontos integer NOT NULL, tipo varchar(20) NOT NULL CHECK(tipo IN ('credito','resgate','ajuste','expiracao')),
 descricao text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.campanhas_marketing (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
 nome varchar(140) NOT NULL, canal varchar(30) NOT NULL DEFAULT 'whatsapp', segmento varchar(40) NOT NULL DEFAULT 'todos',
 mensagem text NOT NULL, status varchar(20) NOT NULL DEFAULT 'rascunho', agendada_para timestamptz,
 enviados integer NOT NULL DEFAULT 0, conversoes integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.consentimentos_marketing (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
 loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE, canal varchar(30) NOT NULL,
 autorizado boolean NOT NULL DEFAULT false, atualizado_em timestamptz NOT NULL DEFAULT now(), UNIQUE(cliente_id,loja_id,canal)
);
CREATE INDEX IF NOT EXISTS idx_pedidos_loja_status_data ON public.pedidos(loja_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_data ON public.pedidos(cliente_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_banners_loja_ativo_ordem ON public.banners_promocionais(loja_id,ativo,ordem);
CREATE INDEX IF NOT EXISTS idx_pontos_cliente_loja ON public.pontos_clientes(loja_id,cliente_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingredientes_loja ON public.ingredientes(loja_id,ativo);

-- Central de entregadores e acesso individual por link seguro.
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS entregador_id uuid;
CREATE TABLE IF NOT EXISTS public.entregadores (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
 nome varchar(120) NOT NULL, telefone varchar(40), veiculo varchar(80),
 token_hash text NOT NULL UNIQUE, ativo boolean NOT NULL DEFAULT true,
 ultima_latitude numeric(10,7), ultima_longitude numeric(10,7),
 localizacao_atualizada_em timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pedidos_entregador_id_fkey') THEN
  ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_entregador_id_fkey FOREIGN KEY(entregador_id) REFERENCES public.entregadores(id) ON DELETE SET NULL;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_entregadores_loja_ativo ON public.entregadores(loja_id,ativo);
CREATE INDEX IF NOT EXISTS idx_pedidos_entregador_status ON public.pedidos(entregador_id,status,created_at);


COMMIT;
