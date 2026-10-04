-- Execute uma vez no Supabase SQL Editor para ativar a Central de Entregadores.
-- Incremental: não remove nem recria dados existentes.
BEGIN;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS entregador_id uuid;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS public_token_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_public_token_hash ON public.pedidos(public_token_hash) WHERE public_token_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.entregadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id uuid NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
  nome varchar(120) NOT NULL,
  telefone varchar(40),
  veiculo varchar(80),
  token_hash text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true,
  ultima_latitude numeric(10,7),
  ultima_longitude numeric(10,7),
  localizacao_atualizada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_entregador_id_fkey') THEN
    ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_entregador_id_fkey
      FOREIGN KEY (entregador_id) REFERENCES public.entregadores(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_entregadores_loja_ativo ON public.entregadores(loja_id, ativo);
CREATE INDEX IF NOT EXISTS idx_pedidos_entregador_status ON public.pedidos(entregador_id, status, created_at);
COMMIT;
