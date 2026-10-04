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


## Integração ampliada de pedidos e rastreamento
- Checkout público usa `POST /api/public-order`: valida loja ativa, disponibilidade, produto e personalizações e grava cliente, pedido e itens em transação.
- O pedido recebe um token de acompanhamento aleatório; apenas o hash fica no banco. A consulta pública `GET /api/order-track?token=...` retorna status e localização autorizada do entregador.
- O painel do comerciante carrega pedidos diretamente das tabelas do Supabase e pode atualizar o status pela rota autenticada.
- A aba Entregadores agora permite atribuir pedidos carregados ao comerciante sem digitar o UUID; escolhe-se um pedido da lista.
- O cliente pode ver o status e a última localização GPS compartilhada enquanto acompanha o pedido. A posição é exibida como link para o mapa, não como mapa incorporado.

### Migração adicional
A atualização exige `public.pedidos.public_token_hash` e seu índice único parcial. Execute a versão atualizada de `entregadores.sql` uma vez no Supabase SQL Editor. Não remove dados.

### Limitações
A taxa de entrega e os cupons ainda não são calculados no servidor nesta etapa (taxa e desconto permanecem zero); o mapa ainda não estima ETA nem otimiza paradas por trânsito. A posição GPS atualiza enquanto a página do motoboy está aberta. Testes locais de sintaxe não substituem um pedido de teste no Supabase de produção.


### Acompanhamento do cliente
No checkout de uma vitrine pública, o cliente recebe um link privado para acompanhar o status. A localização é exibida quando o entregador autoriza e compartilha o GPS pela página do motoboy. A página atualiza o status a cada 12 segundos; não é um canal GPS contínuo em segundo plano, pois o navegador pode suspender a página.

A sequência automática de paradas por proximidade ainda depende de serviço de geocodificação/rotas e configuração de provedor. Nesta versão, o botão de rota abre os destinos atribuídos no Google Maps na ordem da lista, sem prometer otimização automática.
