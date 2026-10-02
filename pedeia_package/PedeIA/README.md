# PedeIA

Projeto independente de pedidos por link para restaurantes, lanchonetes, lojas e outros comercios locais.

## Conceito

O comerciante configura sua loja, categorias e produtos no painel. O PedeIA gera um link publico exclusivo, como `?loja=brasa-e-massa`. O cliente entra por esse link, ve somente aquela loja, monta a sacola e envia os dados de entrega e pagamento.

O cliente nao cria conta nem faz cadastro. Cada comercio possui um identificador publico persistente no link. O painel deixa esse link visivel na lateral, no dashboard e na tela **Minha loja**, com acao para copiar e enviar pelo WhatsApp.

## Rodar

```powershell
npm start
```

Abra `http://localhost:4173` para o painel. Clique em **Ver minha loja** ou use `?loja=brasa-e-massa` para a vitrine do cliente.

Esta primeira versao usa `localStorage` para prototipo. Todo o codigo deste projeto, incluindo servidor, frontend e documentacao, esta dentro desta pasta `PedeIA` e nao depende dos projetos antigos.

## Publicar no GitHub e Render

Envie o conteudo desta pasta para um repositorio proprio chamado `pedeia`. Nao envie `node_modules` nem arquivos `.env`.

No Render, crie um **Web Service** conectado ao repositorio e use:

- **Runtime:** Node
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Health Check Path:** `/api/health`

Se o repositorio tiver somente os arquivos desta pasta, nao preencha **Root Directory**. Se voce enviar a pasta maior contendo `PedeIA`, use `PedeIA` como **Root Directory**.

Depois do deploy, teste `https://SEU-APP.onrender.com/api/health`. A resposta esperada e:

```json
{"ok":true,"service":"pedeia"}
```

O arquivo `render.yaml` ja guarda essa configuracao para o deploy automatico pelo Render Blueprint.
