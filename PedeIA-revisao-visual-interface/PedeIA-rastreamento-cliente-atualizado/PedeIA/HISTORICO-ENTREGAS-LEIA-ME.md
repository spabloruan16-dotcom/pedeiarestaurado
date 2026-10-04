# Histórico de entregas

O histórico registra entregas concluídas pelo entregador ou pelo comerciante quando o pedido está atribuído. O valor registrado é `pedidos.taxa_entrega`, tratado como taxa recebida pelo entregador nesta versão. Se a loja repassar apenas uma parte da taxa, será necessário incluir um campo específico de repasse.

Antes de publicar, execute `historico-entregas.sql` no Supabase. O painel do comerciante mostra contagem e soma das taxas de hoje por entregador e permite abrir o histórico detalhado. O link individual do entregador mostra filtros Hoje, últimos 7 dias e todo o histórico, quantidade e total das taxas.

Os registros anteriores à instalação não são reconstruídos automaticamente, pois não há como confirmar o valor efetivamente repassado a partir do histórico antigo.
