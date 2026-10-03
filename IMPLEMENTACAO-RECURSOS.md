# Extensão avançada do PedeIA

O arquivo `recursos-avancados.sql` é uma migração **incremental** para a estrutura atual em português. Ela não remove nem recria tabelas e não apaga registros. Faça backup antes de executar em produção.

## Incluído na migração
- Campos-base de vitrine (banner, tema, destaque e etiquetas) e opções JSON de produto.
- Snapshot JSON das personalizações no item do pedido e campos para taxa, desconto, cupom e previsão.
- Tabelas para banners, cupons, endereços salvos, ingredientes, fichas técnicas, movimentações de estoque, despesas, fidelidade, pontos, campanhas e consentimento de marketing.
- Índices para consultas comuns de pedidos, estoque e pontos.

## Aplicação
1. Faça backup no Supabase.
2. Abra **SQL Editor** no projeto correto.
3. Revise e execute `recursos-avancados.sql`.
4. Confira o resultado e teste em ambiente de desenvolvimento antes de publicar.

## Importante
A migração prepara o modelo de dados; não habilita sozinha telas, automações, gateway de pagamento, envio de WhatsApp, baixa automática de ingredientes ou notificações. Esses fluxos exigem integração no frontend/backend, validação de autorização por loja, políticas RLS e credenciais de provedores. Não coloque `service_role` no navegador. O checkout existente também não deve ser anunciado como pagamento online integrado sem conectar e testar um gateway.
