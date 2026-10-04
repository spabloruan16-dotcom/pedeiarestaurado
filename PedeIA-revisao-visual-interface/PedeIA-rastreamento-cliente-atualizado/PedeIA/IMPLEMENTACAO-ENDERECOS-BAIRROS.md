# Endereços, bairros e histórico — etapa de implementação

Esta versão adiciona ao checkout campos separados de rua, número, complemento, bairro, cidade, estado e referência. O servidor ainda grava o endereço legível em `pedidos.endereco` para manter a compatibilidade com painéis e telas de entregadores, e também grava o objeto em `pedidos.endereco_partes`.

## Banco

Execute `melhorias-endereco-bairros-historico.sql` no Supabase antes de publicar esta versão. O script é aditivo e não usa o `schema.sql` antigo do projeto. Faça backup antes de qualquer migração em produção.

## Atenção sobre funções em etapas

As tabelas `bairros_atendimento` e `historico_entregas` são a base de dados para as próximas rotas e telas. Esta etapa ainda não implementa a busca automática de bairros por município, seleção de bairros no checkout, taxas variáveis, nem as telas de histórico e totais diários. A lista automática exige uma fonte geográfica e tratamento de cobertura incompleta; deverá permitir sempre a inclusão manual de bairros. Não considerar essas funções ativas até que as interfaces e endpoints correspondentes sejam integrados e testados.

## Rastreamento para retirada

O endpoint `/api/order-track` também retorna o endereço formatado da loja a partir dos campos `endereco_*`. Na página `acompanhar.html`, pedidos do tipo `pickup` exibem o endereço da loja e um link de rota do Google Maps (`/maps/dir/?api=1&destination=...`). A seção de localização do entregador fica oculta para retirada. Se o endereço da loja não estiver preenchido, a página informa que o local precisa ser confirmado com o estabelecimento.

Esta função depende da migração de endereço da loja ter sido executada e dos dados de endereço da loja estarem preenchidos. Não foi possível testar contra o Supabase ou Render remoto neste ambiente.


### Bairros de atendimento e taxas
A tela possui uma seção separada para manter bairros atendidos e a taxa individual de entrega. As sugestões da geocodificação são filtradas para `neighbourhood` e `borough`; resultados classificados apenas como `locality` (cidade/localidade) não são apresentados como bairros. Como a cobertura geográfica pode ser incompleta, o comerciante confirma as sugestões e pode adicionar bairros manualmente. Os valores ficam em `personalizacao_vitrine.serviceNeighborhoods` como objetos `{ nome, taxa }`, mantendo leitura compatível com registros antigos que contenham apenas nomes.
