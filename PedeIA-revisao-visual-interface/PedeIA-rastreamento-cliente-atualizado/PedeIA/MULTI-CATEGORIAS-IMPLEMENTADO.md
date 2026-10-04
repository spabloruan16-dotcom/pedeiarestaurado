# Atualização: produto em múltiplas categorias

Esta versão integra a tabela `public.produto_categorias` já criada no Supabase.

- O cadastro e a edição permitem selecionar uma ou mais categorias.
- O servidor salva os vínculos por produto e loja dentro da transação de estado do comerciante.
- A leitura do cardápio devolve todas as categorias vinculadas; a vitrine apresenta o produto em cada categoria.
- A coluna legada `produtos.categoria_id` permanece como categoria principal para compatibilidade com partes antigas do sistema.
- Ao remover uma categoria, os produtos vinculados a outras categorias são mantidos. Se a remoção deixaria a loja sem categorias e há produtos nessa categoria, a ação é bloqueada para evitar perda acidental.

## Implantação

1. Faça backup do projeto implantado.
2. Substitua os arquivos pelos desta versão e publique no Render.
3. Faça login de comerciante, edite um produto de teste e marque duas categorias.
4. Salve, recarregue o painel e confira se ambas continuam selecionadas.
5. Abra a vitrine pública e confirme que o produto aparece nas duas categorias e pode ser adicionado ao carrinho.

O `schema.sql` incluído no ZIP original não foi usado como fonte nem executado. Esta atualização pressupõe que `public.produto_categorias` já existe conforme o SQL executado pelo usuário. Não foi possível testar contra o banco remoto nesta sessão.
