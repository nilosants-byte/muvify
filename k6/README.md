# Load Tests — Muvify

Testes de performance usando [k6](https://k6.io) (gratuito e open-source).

## Instalação do k6

**Mac:**
```bash
brew install k6
```

**Windows:**
```bash
winget install k6
# ou baixe em: https://k6.io/docs/get-started/installation/
```

**Linux (Ubuntu/Debian):**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

---

## Usuários de teste necessários

Antes de rodar, o servidor precisa ter estes usuários cadastrados (o script `scripts/create-qa-users.ts` cria automaticamente):

```bash
npx tsx scripts/create-qa-users.ts
```

| Tipo         | Email                          | Senha       |
|---|---|---|
| Cliente      | `qa.aluno@muvify.local`        | `Qa123456`  |
| Profissional | `qa.personal@muvify.local`     | `Qa123456`  |

---

## Executando os testes

### Smoke Test — sanidade rápida (~30s)
Use antes de qualquer deploy. Verifica que tudo responde.

```bash
k6 run k6/smoke.js
k6 run k6/smoke.js -e BASE_URL=https://api-staging.muvify.com.br
```

### Load Test — carga realista (~5 min)
Use 1–2 dias antes do lançamento para validar a performance.

```bash
k6 run k6/load.js
k6 run k6/load.js -e BASE_URL=https://api-staging.muvify.com.br
```

### Stress Test — encontra o limite (~10 min)
Descobre quantos usuários simultâneos o servidor aguenta.

```bash
k6 run k6/stress.js -e BASE_URL=https://api-staging.muvify.com.br
```

### Soak Test — estabilidade prolongada (~30 min)
Detecta memory leaks e conexões não fechadas.

```bash
k6 run k6/soak.js -e BASE_URL=https://api-staging.muvify.com.br
```

---

## Rodando via GitHub Actions (sem instalar k6 localmente)

Existe um workflow manual — `.github/workflows/load-test.yml` — que roda
qualquer um dos 4 cenários acima contra a URL que você indicar. Disparo
manual de propósito (`workflow_dispatch`): `stress`/`soak` tentam
ativamente empurrar o servidor até o limite, e não existe ambiente de
staging automático nem gatilho automático seguro pra isso (ver
`docs/CARGA-REAL-GUIA-E-GAPS.md`).

Pra usar: aba **Actions** → **Load Test (k6)** → **Run workflow** →
escolha o cenário e informe a URL alvo. **Nunca aponte `stress`/`soak` pra
produção com usuários reais** — use um ambiente de staging, ou `smoke`/
`load` com moderação se staging não existir.

---

## Variáveis de ambiente

| Variável            | Padrão                         | Descrição                    |
|---|---|---|
| `BASE_URL`          | `http://localhost:3000`        | URL do servidor a testar     |
| `CLIENT_EMAIL`      | `qa-client@muvify.test`        | Email do usuário cliente      |
| `CLIENT_PASSWORD`   | `Test@1234`                    | Senha do usuário cliente      |
| `PROFESSIONAL_EMAIL`| `qa-professional@muvify.test`  | Email do profissional         |
| `PROFESSIONAL_PASSWORD` | `Test@1234`                | Senha do profissional         |

---

## Interpretando os resultados

### O que significa cada métrica

| Métrica | O que é | Meta |
|---|---|---|
| `http_req_duration p(95)` | 95% das requisições abaixo desse tempo | < 500ms |
| `http_req_duration p(99)` | 99% abaixo desse tempo | < 1500ms |
| `http_req_failed` | % de requisições com erro | < 1% |
| `http_reqs` | Total de requisições por segundo (RPS) | quanto maior, melhor |
| `vus` | Usuários virtuais simultâneos | depende do teste |

### Exemplo de saída OK

```
✓ search: 200
✓ health: sempre 200

checks.........................: 100.00%
http_req_duration p(95).......: 245ms
http_req_failed...............: 0.00%
http_reqs.....................: 1820 (6.06/s)
```

### Exemplo de saída com problema

```
✗ search: 200   ← erros aparecendo
✗ health: < 200ms

FAILED THRESHOLDS:
  http_req_duration: p(95)<500 — valor atual: 1847ms
```

---

## Sequência recomendada antes do lançamento

```
Semana -2: rodar smoke (local) → todos passando?
Semana -1: rodar load (staging) → p95 < 500ms?
           rodar stress (staging) → anotar o VU máximo antes de degradar
Dia -1:    rodar soak (staging) → memória estável após 30 min?
Dia 0:     rodar smoke (produção) após deploy → confirmação final
```
