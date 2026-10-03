-- PedeIA: bucket privado para anexos da Central de Atendimento.
-- Execute no Supabase > SQL Editor. Seguro para executar novamente.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'atendimento-arquivos',
  'atendimento-arquivos',
  false,
  15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS "PedeIA atendimento anexos visualizar" ON storage.objects;
CREATE POLICY "PedeIA atendimento anexos visualizar"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'atendimento-arquivos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.admin_roles ar
      WHERE ar.user_id = auth.uid() AND ar.role = 'admin'
    )
  )
);

DROP POLICY IF EXISTS "PedeIA atendimento anexos enviar" ON storage.objects;
CREATE POLICY "PedeIA atendimento anexos enviar"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'atendimento-arquivos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.admin_roles ar
      WHERE ar.user_id = auth.uid() AND ar.role = 'admin'
    )
  )
);
