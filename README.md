# ControlPoint 3.1 — Auditoria de Virada de Turno

PWA de auditoria cruzada de limpeza e organização entre equipes de turno. A equipe que **chega** audita a área deixada pela equipe que está **saindo**, com foto de evidência e motivo descritivo obrigatórios em cada não conformidade.

Stack: Vue 3 (ESM via CDN) · Firebase Auth + Firestore + Storage · Chart.js · PWA.

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

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn()  { return request.auth != null; }
    function profile()   { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
    function isAdmin()   { return signedIn() && profile().role == 'admin'; }

    // Perfis: cada um lê o próprio; admin lê e escreve todos.
    match /users/{uid} {
      allow get:    if signedIn() && (request.auth.uid == uid || isAdmin());
      allow list:   if signedIn();                       // usado no 1º acesso e pelo admin
      allow create: if signedIn() && request.auth.uid == uid;  // bootstrap do 1º admin
      allow write:  if isAdmin();                        // cadastro/edição pelo admin
    }

    // Auditorias: todos os autenticados leem; escrita por autenticados; exclusão só admin.
    match /inspections/{id} {
      allow read: if signedIn();
      allow create, update: if signedIn();
      allow delete: if isAdmin();
    }

    // Configuração: leitura geral, escrita só admin.
    match /config_geral/{doc} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }
    match /config_pontos/{doc} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }
  }
}
```

> **Depois de criar o primeiro administrador**, troque as duas linhas de bootstrap por regras mais restritas:
> ```
> allow list:   if isAdmin();
> allow create: if isAdmin();
> ```
> Assim ninguém consegue se autopromover criando o próprio documento em `users`.

### 3. Storage — regras

Console → **Storage → Começar** (se ainda não iniciado) → aba **Rules**:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /inspecoes/{auditId}/{file} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.resource.size < 3 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

### 4. Domínios autorizados
Console → **Authentication → Settings → Authorized domains** → adicione `SEU-USUARIO.github.io`.

---

## Primeiro acesso

1. Abra o app e toque em **"Primeiro acesso — criar administrador"** na tela de login.
2. Informe nome, e-mail e senha. Se a coleção `users` estiver vazia, essa conta é gravada com `role: admin`; se já houver usuários, a conta fica pendente de liberação.
3. Em **Admin → Config.**, cadastre as equipes, o rodízio, a meta e os pontos de verificação.
4. Em **Admin → Usuários**, cadastre os auditores (nome, e-mail, senha provisória, equipe, perfil).

O cadastro de usuários usa uma instância secundária do Firebase App, então o administrador **não é deslogado** ao criar contas.

Remover um usuário apaga o documento em `users` (bloqueia o acesso ao app), mas a conta permanece no Authentication — exclua pelo console se quiser removê-la de vez.

---

## Modelo de dados

### `users/{uid}`
```json
{ "name": "Maria Silva", "email": "maria@empresa.com", "team": "Equipe 1", "role": "auditor", "createdAt": "..." }
```

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
{ "name": "Sala de Tonalidade L4", "ordem": 1 }
```

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
    { "name": "Sala de Tonalidade L4", "status": "ok",  "checked": true,  "reason": "", "photoUrl": "", "photoPath": "" },
    { "name": "Área de Retido L5",     "status": "nok", "checked": false, "reason": "Resíduo de óleo junto à bancada", "photoUrl": "https://...", "photoPath": "inspecoes/..." }
  ],
  "updatedAt": "..."
}
```

`team` continua sendo a equipe **avaliada** e `checked` é mantido junto de `status`, então as auditorias antigas e os relatórios seguem funcionando.

As fotos ficam em `inspecoes/{auditId}/{timestamp}_{índice}.jpg` no Storage, redimensionadas para no máximo 1280 px e comprimidas em JPEG antes do upload.

---

## Publicar no GitHub Pages

1. Envie todos os arquivos para a raiz do repositório.
2. **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
3. Adicione o domínio `SEU-USUARIO.github.io` nos domínios autorizados do Firebase Auth (passo 4 acima).

O app funciona como PWA: pode ser instalado na tela inicial do celular e abre offline (a gravação exige conexão).

---

## Arquivos

```
index.html      # interface (Vue template + estilos)
app.js          # lógica da aplicação
firebase.js     # credenciais, SDK e criação de usuário pelo admin
sw.js           # service worker (network-first)
manifest.json   # PWA
version.json    # versão exibida na aba Sobre
icon-192.png / icon-512.png
```
