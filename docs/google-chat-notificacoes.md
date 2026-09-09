# Notificações privadas no Google Chat

## Regra de privacidade

O Prova-tri não usa espaço coletivo, grupo ou webhook compartilhado. Cada
destinatário recebe somente na conversa direta com o app `Prova-tri`.

## Ativação por login

1. A pessoa abre o app `Prova-tri` no Google Chat ou envia uma mensagem direta,
   como `Teste`.
2. O Chat envia o ID da conversa privada ao servidor. São aceitos tanto os
   eventos de um app Chat quanto os eventos aninhados de um complemento do
   Google Workspace.
3. O app mostra **Conectar minha conta**.
4. O link usa a sessão de login normal do Prova-tri para associar a conversa
   à conta correta, sem pedir nem inferir e-mail.
5. A tela `Usuários` mostra **Chat conectado**.

Os links de conexão e os redirecionamentos após login usam
`GOOGLE_CHAT_PUBLIC_BASE_URL` como origem pública. Isso impede que um proxy
interno encaminhe a pessoa para `localhost`.

O Google Chat não entrega seu ID interno no login OAuth do Prova-tri. Por
isso a primeira abertura do app é necessária, mas o vínculo em si é feito
automaticamente usando aquele login. Se o app já estava instalado antes de o
endpoint ser configurado, uma nova mensagem direta reinicia somente o
onboarding pendente e mostra novamente o cartão de conexão. Uma conversa já
vinculada não é desconectada por mensagens posteriores.

## Configuração do servidor

```env
GOOGLE_CHAT_SERVICE_ACCOUNT_KEY_PATH=/caminho/seguro/prova-tri-chat.json
GOOGLE_CHAT_PUBLIC_BASE_URL=https://prova.colegioharmonia.com.br
GOOGLE_CHAT_ENDPOINT_AUDIENCE=https://prova.colegioharmonia.com.br/api/integrations/google-chat
GOOGLE_WORKSPACE_ADD_ON_SERVICE_ACCOUNT_EMAIL=service-<NUMERO_DO_PROJETO>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com
```

A service account deve pertencer ao projeto Google Cloud que hospeda o app
Google Chat e usar o escopo `https://www.googleapis.com/auth/chat.bot`. O
endpoint HTTP e a audience no console devem ser exatamente
`https://prova.colegioharmonia.com.br/api/integrations/google-chat`.

Quando a opção **Criar este app do Chat como um complemento do Workspace**
estiver ativa, a conta que assina os eventos é a conta de serviço específica
do complemento, informada pela API Google Workspace Add-ons. Ela deve ser
configurada em `GOOGLE_WORKSPACE_ADD_ON_SERVICE_ACCOUNT_EMAIL`; ela não é a
conta `chat@system.gserviceaccount.com` usada pelo app Chat independente.

## Verificação

Execute `npm run test:google-chat-private`. Depois de ativar o app para uma
pessoa, atribua uma prova de teste. Só a conversa direta dela pode receber a
mensagem; não existe envio para grupo como contingência.
