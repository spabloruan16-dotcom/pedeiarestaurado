-- PedeIA: personalizacao da vitrine, migração incremental e não destrutiva.
-- Execute no Supabase SQL Editor antes de publicar a versão correspondente.
ALTER TABLE public.lojas
  ADD COLUMN IF NOT EXISTS personalizacao_vitrine jsonb NOT NULL DEFAULT '{}'::jsonb;
