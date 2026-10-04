-- Execute no Supabase SQL Editor antes de publicar a versão com personalização.
-- Armazena as regras e opções configuradas pelo comerciante para cada produto.
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS opcoes JSONB NOT NULL DEFAULT '[]'::jsonb;
