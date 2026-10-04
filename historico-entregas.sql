-- Execute uma vez no Supabase SQL Editor antes de publicar a versão com histórico.
-- Mantém o registro mesmo se um pedido for removido, e impede excluir entregador com histórico.
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
CREATE INDEX IF NOT EXISTS historico_entregas_entregador_data_idx ON public.historico_entregas (entregador_id, concluida_em DESC);
CREATE INDEX IF NOT EXISTS historico_entregas_loja_data_idx ON public.historico_entregas (loja_id, concluida_em DESC);
