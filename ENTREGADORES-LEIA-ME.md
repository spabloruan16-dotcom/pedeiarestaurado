# Central de Entregadores — PedeIA

## O que foi adicionado
- Aba **Entregadores** no painel do comerciante.
- Cadastro de nome, telefone e veículo.
- Geração de link individual aleatório; o banco armazena apenas o hash do token.
- Ativação, desativação e exclusão do cadastro.
- Atribuição de um pedido pelo UUID do registro em `public.pedidos`.
- Página móvel `/motoboy?token=...` com pedidos atribuídos, endereços, itens, navegação Google Maps e botão para marcar como entregue.
- Compartilhamento de coordenadas GPS apenas após o motoboy tocar em ativar e conceder permissão. A posição é armazenada no registro do entregador.

## Instalação
1. Faça backup habitual do projeto e publique os arquivos deste pacote.
2. No Supabase SQL Editor, execute **`entregadores.sql`**. É uma migração incremental; não apaga os pedidos existentes.
3. Reinicie/republique o servidor com as variáveis de ambiente já usadas pelo PedeIA (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`).
4. Entre no painel, abra **Entregadores**, cadastre o motoboy e copie o link gerado. O token completo só é exibido no momento do cadastro; guarde-o com segurança. Para substituir um link perdido, desative/exclua esse cadastro e crie outro.
5. Para atribuir pedido, use o UUID do pedido já existente em `public.pedidos`. A atribuição é limitada à loja do comerciante autenticado.

## Limitações desta etapa
- O fluxo de checkout ainda precisa estar conectado à tabela `pedidos` para que novos pedidos sejam selecionáveis diretamente na tela. Por enquanto, a atribuição solicita o UUID do pedido existente.
- O botão de rota envia os endereços disponíveis ao Google Maps na ordem de criação dos pedidos; não faz otimização por proximidade nem considera trânsito/janelas de horário.
- O GPS é compartilhado enquanto a página do motoboy está aberta e a permissão do navegador permanece válida. Esta etapa ainda não exibe o marcador ao cliente nem calcula ETA.
- O link é uma credencial de acesso: não compartilhe publicamente. Desativar o entregador invalida o link.
- A integração precisa ser validada no ambiente Supabase/servidor do projeto. Foi feita validação estática da sintaxe, não um teste de produção.
