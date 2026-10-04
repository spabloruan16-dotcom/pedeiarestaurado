-- Migração aditiva para endereços, bairros e histórico de entregas.
-- Não remove nem renomeia colunas existentes.
ALTER TABLE public.lojas
  ADD COLUMN IF NOT EXISTS endereco_rua text,
  ADD COLUMN IF NOT EXISTS endereco_numero text,
  ADD COLUMN IF NOT EXISTS endereco_complemento text,
  ADD COLUMN IF NOT EXISTS endereco_bairro text,
  ADD COLUMN IF NOT EXISTS endereco_cidade text,
  ADD COLUMN IF NOT EXISTS endereco_estado text,
  ADD COLUMN IF NOT EXISTS endereco_cep text;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS endereco_partes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.bairros_atendimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
  nome varchar(120) NOT NULL,
  taxa_entrega numeric(10,2) NOT NULL DEFAULT 0 CHECK (taxa_entrega >= 0),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja_id, nome)
);
CREATE INDEX IF NOT EXISTS bairros_atendimento_loja_ativo_idx
  ON public.bairros_atendimento (loja_id, ativo, nome);

CREATE TABLE IF NOT EXISTS public.historico_entregas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
  pedido_id uuid NOT NULL UNIQUE REFERENCES public.pedidos(id) ON DELETE CASCADE,
  entregador_id uuid NOT NULL REFERENCES public.entregadores(id) ON DELETE RESTRICT,
  taxa_recebida numeric(10,2) NOT NULL DEFAULT 0 CHECK (taxa_recebida >= 0),
  concluida_em timestamptz NOT NULL DEFAULT now(),
  endereco text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS historico_entregas_entregador_data_idx
  ON public.historico_entregas (entregador_id, concluida_em DESC);
CREATE INDEX IF NOT EXISTS historico_entregas_loja_data_idx
  ON public.historico_entregas (loja_id, concluida_em DESC);
