# ControlPoint 3.7 — Auditoria de Virada de Turno

PWA de auditoria cruzada de limpeza e organização entre equipes de turno. A equipe que **chega** audita a área deixada pela equipe que está **saindo**, com foto de evidência e motivo descritivo obrigatórios em cada não conformidade.

Stack: Vue 3 (ESM via CDN) · Firebase Auth + Firestore (plano gratuito) · Chart.js · PWA.

---

## Novidades da 3.7 — continuar de onde parou

O auditor é interrompido no meio do trabalho: chamado urgente, bateria, uma troca de aba que o navegador decide descartar. Antes, tudo se perdia. Agora a auditoria em andamento é gravada **no aparelho** a cada alteração.

### Como funciona
- Cada mudança — status, motivo, foto — agenda a gravação do rascunho (com 0,7 s de folga, para não escrever a cada tecla).
- Quando o app vai para o segundo plano ou é fechado, a gravação acontece **na hora** (`visibilitychange` e `pagehide`), que é o que o celular realmente dispara ao trocar de app.
- Ao reabrir: se o rascunho é do **mesmo turno** que a escala indica, a auditoria é retomada sozinha, com um aviso de quantos pontos já estavam feitos.
- Se o rascunho é de **outro turno**, aparece uma faixa no topo com o resumo (equipe, data, turno, pontos avaliados, fotos) e dois botões: **Continuar** ou **Descartar**.
- Descartar apaga também as **fotos órfãs** daquele rascunho — só as que nunca foram vinculadas a uma auditoria salva, verificadas uma a uma antes da remoção.
- Concluir a auditoria limpa o rascunho automaticamente.

### Detalhes que importam
- O rascunho é **por usuário** (`cp_draft_<uid>`): dois auditores no mesmo aparelho não veem o trabalho um do outro.
- **Expira em 7 dias**, para não ressuscitar uma auditoria esquecida de semanas atrás.
- As fotos **não ficam no rascunho** — elas já vão para o Firestore no momento da captura, então o rascunho guarda apenas o id de cada uma. Isso mantém o rascunho em poucos KB e as imagens intactas mesmo que o navegador limpe outras coisas.
- Um selo discreto ("Progresso salvo neste aparelho") confirma ao auditor que ele pode sair sem medo.

> **Limite conhecido:** o rascunho vive no aparelho onde a auditoria foi começada. Trocar de celular no meio do trabalho não traz o progresso — mas as fotos já tiradas continuam no banco e são reaproveitadas quando o mesmo turno é auditado de novo.

---

## Novidades da 3.6 — foto do local obrigatória

### Toda avaliação precisa de imagem
A foto deixou de ser exigência só da não conformidade: **todo ponto exige a foto do local**, conforme ou não. Os botões de conforme e não conforme ficam travados até a imagem existir, e tocar neles abre a câmera. O botão da câmera pulsa enquanto falta foto, e remover a imagem apaga a avaliação daquele ponto, para não sobrar nota sem lastro.

O botão "Todos conformes" passou a alcançar apenas os pontos já fotografados, avisando quantos ainda faltam.

### Galeria para o administrador
Nova aba **Admin → Fotos**: todas as imagens do mês em grade, com etiqueta de conforme, não conforme ou correção, e filtros por tipo e por equipe auditada. Cada miniatura mostra o ponto, a equipe, a data, o turno e quem fotografou. Há também a contagem de fotos por auditor no mês, útil para perceber quem está pulando etapa.

As imagens carregam sob demanda, 12 por vez, para não pesar o carregamento.

### Compressão proporcional ao uso
A foto de rotina (ponto conforme) é guardada em até **70 KB**; a evidência de não conformidade continua em até **150 KB**, porque precisa de detalhe para servir de prova.

### Limpeza de fotos antigas
Em **Admin → Config.**, o botão "Liberar espaço" apaga as imagens de auditorias anteriores a 3, 6, 12 ou 24 meses. Pontos, motivos, notas e tratativas permanecem — só as imagens saem, e a remoção fica registrada no histórico da auditoria.

> **Por que isso importa:** com 16 fotos por auditoria e duas auditorias por dia, o consumo fica em torno de **1 MB por auditoria**, ou cerca de 2 MB por dia. O 1 GB gratuito do Firestore cobre algo perto de **16 meses** nesse ritmo. A limpeza semestral mantém o uso estável e dentro do plano gratuito indefinidamente.

---

## Novidades da 3.5 — sem Cloud Storage

O Cloud Storage passou a exigir o plano Blaze em projetos novos. Para manter a aplicação **inteiramente no plano gratuito (Spark)**, as fotos deixaram de ir para o Storage e passaram a ser gravadas no próprio Firestore.

Como funciona:

- a imagem é comprimida em degraus (1024px/0.6 → 520px/0.35) até ficar abaixo de **150 KB**;
- cada foto vira um documento na coleção **`inspection_photos`** — `{ data, pointName, field, auditId, by, team, createdAt }`;
- a auditoria guarda apenas o **id** da foto (`photoDocId`), então listar auditorias não baixa imagem nenhuma;
- a imagem só é lida do banco quando alguém toca em "Visualizar imagem", e fica em cache na sessão;
- com o cache persistente do Firestore, a foto é gravada mesmo offline e sobe sozinha depois — o contador no topo mostra quantos envios estão pendentes.

**Não é preciso ativar o Storage.** O arquivo `storage.rules` foi removido; as regras da nova coleção já estão no `firestore.rules`.

Limites na prática: o plano gratuito oferece 1 GB de armazenamento no Firestore, o que comporta cerca de **7.000 fotos** nesse tamanho, e 50 mil leituras por dia. Se um dia o volume apertar, dá para apagar fotos antigas mantendo o texto das auditorias, ou migrar para o Storage trocando só as funções `savePhotoDoc` e `loadPhotoData`.

Como o PDF agora tem a imagem em base64 na mão, as evidências passaram a ser **embutidas no PDF** da auditoria.

---

## Novidades da 3.4

### Regras de segurança endurecidas
As regras agora estão versionadas em **`firestore.rules`**. Copie o conteúdo para o console (Firestore → Regras) e publique. O que muda na prática:

- a auditoria só pode ser criada em nome da **própria equipe** e assinada pelo próprio usuário;
- a equipe auditada pode dar ciência e tratar as não conformidades, mas **não consegue alterar a própria nota**;
- a equipe auditora pode corrigir o que registrou, sem trocar as equipes envolvidas;
- só o administrador exclui auditorias e gerencia usuários e configurações;
- o usuário comum só pode alterar, no próprio perfil, a marcação de senha trocada.

Antes disso, qualquer pessoa logada conseguia, pelo console do navegador, editar a nota de qualquer auditoria. A interface não permitia — as regras agora também não.

### Histórico de alterações
Cada auditoria guarda um `historico[]` com quem fez o quê e quando: registro inicial, ciência, contestação, tratativa e edição pelo admin (com o score antes e depois e os pontos alterados). Aparece no modal de edição e no relatório.

### Auditoria em poucos toques
Botão **"Todos conformes"** marca de uma vez os pontos ainda não avaliados; o auditor só desmarca as exceções. Ao lado, um botão de limpar reinicia a lista.

### Reincidência e tendência
- O mesmo ponto reprovado **3 ou mais vezes em 30 dias** na mesma equipe vira um alerta próprio na central, com quantas ainda estão sem resolver.
- O relatório mensal ganhou coluna de **tendência** comparando com o mês anterior (▲ / ▼ em pontos percentuais).

### PDF e antes/depois
Botão **PDF** no relatório da auditoria gera um documento com cabeçalho, resultado, não conformidades (com motivo, tratativa e link da evidência) e ciência. Na tratativa, as fotos de antes e depois aparecem lado a lado.

### Desempenho
A lista de auditorias carrega 20 por vez, com "Carregar mais", e as consultas da central têm limite de leitura.

---

## Novidades da 3.3

### Funciona offline
O Firestore usa cache persistente (IndexedDB), então a auditoria é salva mesmo sem rede e sobe sozinha quando a conexão volta. As fotos, que não podem ser enviadas offline, vão para uma **fila local** (`offline.js`) e são enviadas em segundo plano — ao terminar, o app atualiza o documento da auditoria com a URL da imagem.

No topo da tela há um indicador: nuvem (tudo certo), número (fotos na fila) ou "Offline". Tocar nele força a sincronização.

### Ciclo de tratativa da não conformidade
Cada ponto reprovado ganha um ciclo: **aberta → em tratativa → resolvida**, com responsável, prazo, observação e **foto do depois** (obrigatória para marcar como resolvida). A central de notificações mostra o painel de situação, filtros por status e destaque para o que passou do prazo.

### Ciência da equipe auditada
A equipe avaliada confirma que viu o resultado (**De acordo**) ou registra uma **contestação** com justificativa. Enquanto não houver resposta, a auditoria aparece em "Aguardando ciência" e conta no sino.

### Área e peso dos pontos
Cada ponto de verificação tem uma **área** (L4, L5, L6, Geral…) e um **peso de criticidade** (1 a 3). A tela de auditoria agrupa os pontos por área, e o percentual passa a ser **ponderado**: um ponto peso 3 pesa o triplo de um peso 1 no resultado. As ocorrências também são ranqueadas por área.

> Pontos antigos sem esses campos assumem `area: "Geral"` e `peso: 1`, então o cálculo continua idêntico ao anterior até você ajustar.

---

## Novidades da 3.2

### Relatório compartilhável
Ao concluir a auditoria, abre um modal com o relatório pronto: equipe auditada, auditora, data, turno, percentual e a lista de não conformidades com motivo e link da foto. Botões de **Compartilhar** (menu nativo do celular), **WhatsApp** e **Copiar**. O mesmo relatório pode ser reaberto depois pelo ícone de compartilhar em *Auditorias* e em *Admin → Avaliações*.

### Equipe ADM
A equipe `ADM` vem cadastrada por padrão e pode auditar qualquer equipe: na tela de auditoria aparece um seletor "Seguir a escala" ou a equipe escolhida manualmente. Auditorias feitas pela ADM recebem o sufixo `_ADM` no id do documento, então **não sobrescrevem** a auditoria do rodízio para o mesmo turno — ambas contam no histórico. A ADM não entra na escala 12x36 nem no ranking.

### Senhas e acesso
- **Primeiro acesso obrigatório:** todo usuário criado pelo admin nasce com `mustChangePassword: true` e é levado a uma tela de definição de senha antes de usar o app.
- **Esqueci minha senha:** o auditor informa só o e-mail; o link recebido abre o próprio app na tela "Cadastre sua nova senha" e, ao salvar, já entra logado.
- **Bloqueio:** após **4 tentativas** de senha errada o acesso àquele e-mail é bloqueado por 15 minutos, com aviso de quantas tentativas restam. O contador é por dispositivo (complementa a proteção do próprio Firebase) e zera com o reset de senha.
- A opção de criar administrador foi retirada da tela de login (veja abaixo como criar o primeiro).

> **Configuração obrigatória para o reset funcionar dentro do app:**
> Console → **Authentication → Templates → Redefinição de senha → editar (lápis) → Personalizar URL de ação** e informe o endereço do app, por exemplo `https://SEU-USUARIO.github.io/SEU-REPO/index.html`. Sem isso, o link abre a página padrão do Firebase em vez da tela do ControlPoint.

---

## Novidades da 3.1

### Escala 12x36 automática
O app identifica sozinho quem está em campo. A escala é de dois dias:

| | Turno Dia (06h–18h) | Turno Noite (18h–06h) |
|---|---|---|
| Dia de referência (par A) | Equipe 1 | Equipe 2 |
| Dia seguinte (par B) | Equipe 3 | Equipe 4 |

Dessa escala sai o rodízio sozinho: quem chega audita o turno que acabou de encerrar — 1→4, 4→3, 3→2, 2→1. A tela de auditoria já abre no turno correto, e o auditor não escolhe mais nada. Configure em **Admin → Config. → Escala 12x36** (data de referência, pares e horários), com prévia dos próximos dias. O modo **Manual** desliga a automação e volta a usar o rodízio fixo.

### Central de notificações
Sino no topo, com contador. Duas abas:

- **Pendentes** — turnos já encerrados nos últimos 7 dias sem auditoria registrada, com quantas horas de atraso e botão que abre a auditoria já posicionada na data e turno certos.
- **Não conformidades** — ocorrências dos últimos 30 dias, com motivo e foto, além do ranking dos pontos que mais se repetem.

Auditor vê apenas a própria equipe (com o recorte "Da nossa equipe" / "Que reportamos"); o administrador vê todas as equipes e pode filtrar por equipe.

---

## O que mudou na versão 3.0

| Antes | Agora |
|---|---|
| Cada equipe registrava a própria inspeção | Rodízio cruzado: 1→4, 4→3, 3→2, 2→1 (configurável) |
| Cadastro livre de conta | Login por e-mail/senha, contas criadas pelo administrador |
| Sem turno | Dois turnos: Dia e Noite |
| Checkbox simples + observação opcional | Conforme / Não conforme, com **motivo** e **foto** obrigatórios na não conformidade |
| Sem visão para a equipe avaliada | Aba "Recebidas" mostra o que a equipe recebeu, com fotos e motivos |
| Admin só editava pontos e meta | Painel com avaliações (editar/excluir), usuários, equipes, rodízio, meta e pontos |
| Layout desktop adaptado | Interface mobile-first, tema claro/escuro |

---

## Configuração do Firebase

O projeto já aponta para `controlpoint-1728a`. Antes de usar, habilite e configure:

### 1. Authentication
Console → **Authentication → Sign-in method → E-mail/senha → Ativar**.

### 2. Firestore — regras

Copie o conteúdo de **`firestore.rules`** (na raiz do repositório) em Console → **Firestore → Regras** e publique.

### 3. Cloud Storage — não é necessário

As fotos ficam no Firestore (veja "Novidades da 3.5"). Não ative o Storage nem o plano Blaze.

### 4. Domínios autorizados
Console → **Authentication → Settings → Authorized domains** → adicione `SEU-USUARIO.github.io`.

---

## Primeiro acesso

O primeiro administrador é criado **pelo console do Firebase** (a tela de login não cria contas):

1. **Authentication → Users → Add user**: informe e-mail e senha.
2. Copie o **UID** gerado.
3. **Firestore → Iniciar coleção `users`** → ID do documento = o UID copiado → campos:
   - `name` (string): nome do administrador
   - `email` (string): o mesmo e-mail
   - `team` (string): `ADM`
   - `role` (string): `admin`
4. Entre no app com esse e-mail e senha.
3. Em **Admin → Config.**, cadastre as equipes, o rodízio, a meta e os pontos de verificação.
4. Em **Admin → Usuários**, cadastre os auditores (nome, e-mail, senha provisória, equipe, perfil).

O cadastro de usuários usa uma instância secundária do Firebase App, então o administrador **não é deslogado** ao criar contas.

Remover um usuário apaga o documento em `users` (bloqueia o acesso ao app), mas a conta permanece no Authentication — exclua pelo console se quiser removê-la de vez.

---

## Modelo de dados

### `users/{uid}`
```json
{
  "name": "Maria Silva",
  "email": "maria@empresa.com",
  "team": "Equipe 1",
  "role": "auditor",
  "mustChangePassword": true,
  "createdAt": "..."
}
```
`team` pode ser `ADM` para quem audita qualquer equipe. `mustChangePassword` vira `false` assim que o usuário define a senha definitiva.

### `config_geral/meta_padrao` · `config_geral/equipes` · `config_geral/rodizio` · `config_geral/escala`
```json
{ "valor": 93 }
{ "lista": ["Equipe 1","Equipe 2","Equipe 3","Equipe 4"] }
{ "mapa": { "Equipe 1": "Equipe 4", "Equipe 4": "Equipe 3", "Equipe 3": "Equipe 2", "Equipe 2": "Equipe 1" } }
{
  "ativo": true,
  "dataRef": "2026-09-26",
  "diaA": "Equipe 1", "noiteA": "Equipe 2",
  "diaB": "Equipe 3", "noiteB": "Equipe 4",
  "inicioDia": 6, "inicioNoite": 18
}
```

`dataRef` é qualquer dia em que o par A esteja em campo; a paridade dos dias faz o resto. O turno da noite que atravessa a meia-noite continua pertencendo ao dia em que começou.

### `config_pontos/{id}`
```json
{ "name": "Sala de Tonalidade L4", "area": "L4", "peso": 2, "ordem": 1 }
```

### `inspection_photos/{id}`
```json
{
  "data": "data:image/jpeg;base64,...",
  "pointName": "Área de Retido L5",
  "field": "photo",
  "auditId": "Equipe 4_2026-09-25_Noite",
  "by": "<uid>", "team": "Equipe 1",
  "createdAt": "..."
}
```
`field` é `photo` (evidência da não conformidade) ou `after` (foto da correção).

### `inspections/{equipeAuditada}_{data}_{turno}`
```json
{
  "team": "Equipe 4",
  "auditorTeam": "Equipe 1",
  "auditorName": "Maria Silva",
  "auditorUid": "...",
  "date": "2026-09-25",
  "shift": "Noite",
  "score": 94,
  "meta": 93,
  "points": [
    { "name": "Sala de Tonalidade L4", "area": "L4", "peso": 1, "status": "ok", "checked": true, "reason": "", "photoDocId": "" },
    {
      "name": "Área de Retido L5", "area": "L5", "peso": 2,
      "status": "nok", "checked": false,
      "reason": "Resíduo de óleo junto à bancada",
      "photoDocId": "ph_abc123",
      "treatment": {
        "status": "resolvida",
        "responsavel": "João",
        "prazo": "2026-09-28",
        "nota": "Área higienizada e bandeja de contenção instalada",
        "afterPhotoDocId": "ph_def456",
        "resolvedAt": "...", "resolvedBy": "João"
      }
    }
  ],
  "acknowledgement": {
    "status": "ok",
    "name": "Carlos Souza", "team": "Equipe 4",
    "comment": "", "at": "..."
  },
  "updatedAt": "..."
}
```

`score` é ponderado pelo `peso` dos pontos. `acknowledgement.status` é `ok` ou `contested`.

`team` continua sendo a equipe **avaliada** e `checked` é mantido junto de `status`, então as auditorias antigas e os relatórios seguem funcionando.

As fotos ficam na coleção `inspection_photos`, comprimidas para até 150 KB, e são carregadas só quando abertas.

---

## Página de apresentação

O arquivo **`index.html`** é uma página institucional independente: explica o problema, a lógica do rodízio 12x36, o ciclo da não conformidade, os recursos e as dúvidas frequentes. Não usa Vue nem Firebase — é HTML e CSS puros, com um único trecho de JavaScript para a animação de entrada.

### Entrada automática de quem já tem sessão

Quem já está logado não precisa ver a apresentação de novo. O app grava em `localStorage` uma dica leve da sessão (`cp_last_session`, com uid, nome, equipe e data) ao autenticar, e apaga ao sair. A landing lê essa chave num script no `<head>`, antes de renderizar, e usa `location.replace('./app.html')` — sem piscar o conteúdo e sem criar entrada no histórico.

Proteções contra os problemas clássicos desse tipo de redirecionamento:

- **Laço com o botão voltar**: se o visitante chega vindo do app (`document.referrer` contém `app.html`), a landing marca `cp_stay` na `sessionStorage` e não devolve para lá.
- **Ver a apresentação de propósito**: `index.html?stay=1` (ou `#ficar`) desliga o redirecionamento pelo resto da sessão. É o link usado na aba *Sobre* dentro do app.
- **Dica velha**: depois de 30 dias a chave é ignorada e apagada.
- **Falha no meio do caminho**: se o redirecionamento não acontecer em 2,5 s, a página reaparece em vez de ficar em branco.

Quando existe sessão mas o redirecionamento foi dispensado, a landing se adapta: o hero mostra "Continuar como {nome}" e os botões passam a dizer "Voltar para o app".

A dica **não é autenticação** — quem manda continua sendo o Firebase Auth. Se a sessão tiver expirado ou sido revogada, o app simplesmente mostra a tela de login. Por isso ela guarda só nome e equipe, nada sensível.

Endereços:

- apresentação: `https://SEU-USUARIO.github.io/SEU-REPO/` (raiz)
- app: `https://SEU-USUARIO.github.io/SEU-REPO/app.html`

O `start_url` do `manifest.json` aponta para `./app.html`, então o atalho instalado no celular abre o app direto, sem passar pela apresentação.

## Publicar no GitHub Pages

1. Envie todos os arquivos para a raiz do repositório.
2. **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
3. Adicione o domínio `SEU-USUARIO.github.io` nos domínios autorizados do Firebase Auth (passo 4 acima).

O app funciona como PWA: pode ser instalado na tela inicial do celular e abre offline (a gravação exige conexão).

---

## Arquivos

```
index.html      # página de apresentação (institucional) — é o que abre na raiz
app.html        # interface do app (Vue template + estilos)
app.js          # lógica da aplicação
firebase.js     # credenciais, SDK (com cache persistente) e criação de usuário pelo admin
firestore.rules # regras de segurança do banco (copiar para o console)
sw.js           # service worker (network-first)
manifest.json   # PWA
version.json    # versão exibida na aba Sobre
icon-192.png / icon-512.png
```
