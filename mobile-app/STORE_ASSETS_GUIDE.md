# Guia de Assets para as Lojas — Muvify

Execute o diagnóstico a qualquer momento com:
```bash
node scripts/check-store-assets.mjs
```

---

## STATUS ATUAL

| Asset | Status | Observação |
|---|---|---|
| `icon.png` 1024×1024 | ✅ Pronto | iOS + Android base |
| `splash-light.png` e `splash-dark.png` | ✅ Pronto | 1290×2796 |
| Android adaptive icon (foreground, bg) | ✅ Aceitável (512×512) | EAS recomenda 1024×1024 mas 512 funciona |
| Android monochrome icon | ✅ Aceitável (432×432) | Dentro do spec do Google |
| Screenshots capturadas (390×844) | ⚠ Requer recaptura | Tamanho de simulador, não aceito pelas lojas |
| Screenshots para App Store (1290×2796) | ✗ Faltando | Ver Passo 2 abaixo |
| Screenshots para Google Play | ✗ Faltando | Ver Passo 2 abaixo |
| Google Play Feature Graphic (1024×500) | ✗ Faltando | Ver Passo 3 abaixo |

---

## PASSO 1 — Ícones (rápido, pouco trabalho)

### Ícone principal (`icon.png`)
**Status: ✅ PRONTO** — 1024×1024, PNG, sem fundo transparente.

### Ícones Android adaptativos
**Status: ✅ Aceitável** — Os arquivos existentes (512×512) funcionam para build e publicação.
Para qualidade máxima no Android 13+, o ideal é 1024×1024. Mas não é bloqueante.

**Localização:**
```
assets/android-icon-foreground.png   ← logo sem fundo (512×512, aceitável)
assets/android-icon-background.png   ← fundo sólido ou gradiente (512×512)
assets/android-icon-monochrome.png   ← versão monocromática (432×432)
```

---

## PASSO 2 — Screenshots para as Lojas

Este é o trabalho mais importante. As screenshots existentes estão em resolução de simulador (390×844) e não são aceitas pelas lojas.

### Resoluções exigidas

**Apple App Store:**
| Dispositivo | Resolução obrigatória | Obs |
|---|---|---|
| iPhone 6.7" (iPhone 15 Pro Max) | **1290×2796** | Obrigatório |
| iPhone 6.5" (iPhone 14 Plus) | **1284×2778** | Obrigatório |
| iPhone 5.5" (iPhone 8 Plus) | 1242×2208 | Opcional, recomendado |

Você pode usar **as mesmas screenshots para os dois tamanhos obrigatórios** se capturar em 1290×2796. O App Store Connect aceita isso.

**Google Play:**
| Tipo | Resolução | Obs |
|---|---|---|
| Screenshots de celular | Mínimo 320px, máximo 3840px | Proporção 9:16 recomendada |
| Mínimo de screenshots | 2 | Máximo 8 |

### Como capturar nas resoluções corretas

**Opção A — Captura em dispositivo físico (mais fácil)**
1. Use um iPhone 14 Plus ou superior para iOS (ele captura em 1284×2778 nativamente)
2. Use qualquer Android moderno para Google Play

**Opção B — Simulador iOS (Mac necessário)**
1. Abra o Xcode Simulator
2. Selecione "iPhone 15 Pro Max" (1290×2796)
3. Rode o app: `npx expo start --ios`
4. Tire screenshots com `⌘+S` no simulador — salva em 1290×2796

**Opção C — EAS Build com screenshots automáticas**
Com o Apple Developer ativo, o EAS pode gerar screenshots automaticamente:
```bash
eas build --platform ios --profile production
# Após o build, use Fastlane Snapshot ou Screenshots CLI
```

### Organização final das screenshots

Após capturar, organize assim:
```
assets/store/
  ios/
    iphone67/          ← iPhone 6.7" — 1290×2796
      01_home.png
      02_busca.png
      03_perfil.png
      04_agenda.png
      05_consultoria.png
    iphone65/          ← iPhone 6.5" — 1284×2778
      (mesmas screenshots redimensionadas ou capturadas)
  android/
    01_home.png        ← qualquer resolução 9:16
    02_busca.png
    03_perfil.png
    04_agenda.png
```

### Conteúdo recomendado (6-8 screenshots)

Com base nas telas do Muvify, estas são as screenshots mais impactantes:

| # | Tela | Público |
|---|---|---|
| 1 | Home do profissional (saudação + métricas) | Profissional |
| 2 | Busca de profissionais (cliente) | Cliente |
| 3 | Perfil do profissional | Cliente |
| 4 | Tela de agenda com horários | Ambos |
| 5 | Tela de consultoria / ofertas | Profissional |
| 6 | Tela de agendamento confirmado | Cliente |

> **Dica:** Adicione texto e mockup de dispositivo nas screenshots usando Figma, Canva ou
> [AppMockUp](https://app-mockup.com) (gratuito). Screenshots "decoradas" convertem muito mais.

---

## PASSO 3 — Feature Graphic do Google Play

**Status: ✗ Faltando** — Obrigatório para publicar na Play Store.

**Especificações:**
- Tamanho: **1024×500 pixels**
- Formato: PNG ou JPG
- É o banner exibido no topo da página do app no Google Play

**O que colocar:**
- Logo Muvify + tagline ("O app do personal trainer profissional")
- Fundo verde escuro (cor da marca) com imagem de fundo sutil
- Sem texto muito pequeno (será exibido em tamanhos variados)

**Ferramentas gratuitas:**
- [Canva](https://canva.com) — template "Feature Graphic Google Play" (grátis)
- Figma — mais controle

**Salvar em:** `assets/store/google-play-feature.png`

---

## PASSO 4 — Textos para as Lojas

Além das imagens, as lojas exigem textos descritivos. Prepare com antecedência:

### App Store Connect
| Campo | Limite | Dica |
|---|---|---|
| Nome do app | 30 chars | "Muvify — Personal Trainer" |
| Subtítulo | 30 chars | "Gerencie sua agenda e alunos" |
| Descrição | 4000 chars | Foco nos benefícios, não funcionalidades |
| Palavras-chave | 100 chars | "personal trainer,academia,treino,fitness,agendamento" |
| URL de suporte | — | `https://muvify.com.br/suporte` (ou email) |
| URL de privacidade | — | `https://muvify.com.br/privacidade` (obrigatório) |

### Google Play Console
| Campo | Limite | Dica |
|---|---|---|
| Título | 30 chars | "Muvify" |
| Descrição curta | 80 chars | Frase de impacto |
| Descrição longa | 4000 chars | Pode reutilizar a da Apple |
| Política de privacidade | — | Obrigatório |

---

## PASSO 5 — Checklist final antes de submeter

```
Ícones
  [ ] icon.png 1024×1024 ✅ (já pronto)
  [ ] Android adaptive icons ✅ (já prontos)

App Store iOS
  [ ] 5+ screenshots em 1290×2796 (iPhone 6.7")
  [ ] 5+ screenshots em 1284×2778 (iPhone 6.5")
  [ ] Textos (nome, subtítulo, descrição, keywords)
  [ ] URL de privacidade publicada e acessível
  [ ] Classificação indicativa (responder questionário no App Store Connect)
  [ ] Apple Developer Program ativo ($99/ano)

Google Play Android
  [ ] Feature Graphic 1024×500
  [ ] 2-8 screenshots (qualquer resolução 9:16)
  [ ] Textos (título, descrição curta, longa)
  [ ] URL de privacidade
  [ ] Classificação indicativa (questionário no Play Console)
  [ ] Conta Google Play Console ativa ($25 único)
```

---

## Verificar assets a qualquer momento

```bash
node scripts/check-store-assets.mjs
```
