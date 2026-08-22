// Landing page pública de lista de espera pré-lançamento. Vive aqui (mesmo
// backend, sem prefixo /api) pelo mesmo motivo já documentado em
// public.routes.ts:6-11 pras páginas legais: não há domínio de marketing
// dedicado ainda — assim que um DNS apontar pra este backend, /lista-espera
// já funciona, sem nenhuma mudança de código.
//
// Sem JavaScript obrigatório: formulário HTML puro, POST + redirect
// (padrão Post/Redirect/Get). O toggle "Sou aluno" / "Sou profissional" é
// um par de radio nativos, e o conteúdo que muda conforme a escolha (título,
// cards, benefícios) também é resolvido só com CSS via `:has()` — nenhuma
// dependência de JS pra personalização, então a fricção de cadastro não
// depende do navegador do visitante ter JS habilitado (raro, mas landing
// pages de campanha em vídeo recebem tráfego de todo tipo de navegador
// embutido). `:has()` tem suporte amplo em navegadores modernos (Chrome/
// Edge/Firefox/Safari, todos desde 2023) - decisão consciente de não
// oferecer fallback pra navegadores muito antigos aqui: sem JS, o pior caso
// nesses navegadores é ver o conteúdo padrão (aluno) mesmo marcando
// profissional, não a página quebrar.
//
// CSS servido via <link> pra /waitlist.css (public.routes.ts), não inline
// em <style>: a CSP global (helmet, app.ts) não declara style-src próprio,
// então herda default-src 'self' — que bloqueia <style> inline sem
// 'unsafe-inline'. Mesma solução já usada pelas páginas legais (LEGAL_CSS
// sai por /legal.css em vez de inline).
const BRAND_GREEN = "#24E66D";
const SOCIAL_PROOF_MIN_COUNT = 25;

export const WAITLIST_CSS = `
  :root { color-scheme: light dark; --green: ${BRAND_GREEN}; --bg: #0b0d10; --card: #14171b;
    --text1: #f4f6f5; --text2: #b7bfc2; --text3: #7c8688; --border: rgba(255,255,255,0.10); }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text1); line-height: 1.5; }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f7f8f7; --card: #ffffff; --text1: #12161a; --text2: #4a5559; --text3: #7c8688; --border: rgba(0,0,0,0.08); }
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px 80px; }
  .logo { font-weight: 800; font-size: 20px; letter-spacing: 2px; text-transform: uppercase;
    padding: 28px 0 0; text-align: center; }
  .logo span { color: var(--green); }
  .hero { text-align: center; padding: 28px 0 8px; }
  .kicker { color: var(--green); font-weight: 800; font-size: 13px; letter-spacing: 1px;
    text-transform: uppercase; margin: 0 0 10px; }
  h1 { font-size: clamp(30px, 6vw, 44px); font-weight: 800; letter-spacing: -0.02em; margin: 0 0 14px; }
  h1 .accent { color: var(--green); }
  .sub { color: var(--text2); font-size: 17px; max-width: 480px; margin: 0 auto 28px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  .toggle { display: flex; border: 1px solid var(--border); border-radius: 10px; padding: 4px; gap: 4px; }
  .toggle label { flex: 1; text-align: center; padding: 10px 8px; border-radius: 7px; font-weight: 700;
    font-size: 14px; color: var(--text2); cursor: pointer; }
  .toggle input { position: absolute; opacity: 0; pointer-events: none; }
  .toggle input:checked + label { background: var(--green); color: #06210f; }
  input[type=email], input[type=text], input[type=tel] {
    width: 100%; padding: 13px 14px; border-radius: 10px; border: 1px solid var(--border);
    background: transparent; color: var(--text1); font-size: 15px; }
  input::placeholder { color: var(--text3); }
  .optional-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 480px) { .optional-row { grid-template-columns: 1fr; } }
  .cta { background: var(--green); color: #06210f; border: none; border-radius: 10px;
    padding: 15px; font-size: 15px; font-weight: 800; cursor: pointer; }
  .cta:hover { filter: brightness(1.05); }
  .proof { text-align: center; color: var(--text3); font-size: 13px; margin-top: 14px; }
  .error-box { background: rgba(239,68,68,0.10); border: 1px solid rgba(239,68,68,0.28);
    color: #fca5a5; border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-bottom: 4px; }
  .success-box { text-align: center; padding: 20px 4px; }
  .success-box .check { width: 52px; height: 52px; border-radius: 50%; background: var(--green);
    color: #06210f; display: flex; align-items: center; justify-content: center; font-size: 26px;
    font-weight: 800; margin: 0 auto 16px; }
  section { padding: 56px 0; }
  section h2 { font-size: 24px; font-weight: 800; text-align: center; margin: 0 0 32px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  @media (max-width: 640px) { .grid3 { grid-template-columns: 1fr; } }
  .feature { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
  .feature .icon { font-size: 22px; margin-bottom: 10px; }
  .feature h3 { font-size: 15px; margin: 0 0 6px; }
  .feature p { font-size: 13.5px; color: var(--text2); margin: 0; }
  .benefits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .benefits li { display: flex; gap: 10px; align-items: flex-start; color: var(--text2); font-size: 15px; }
  .benefits li b { color: var(--text1); }
  .check-mark { color: var(--green); font-weight: 800; flex-shrink: 0; }
  footer { border-top: 1px solid var(--border); padding: 28px 0; text-align: center;
    color: var(--text3); font-size: 13px; }
  footer a { color: var(--text2); text-decoration: none; margin: 0 8px; }
  footer a:hover { color: var(--green); }

  /* Personalização por audiência - só CSS, sem JS. Aluno é o estado padrão
     (radio "checked" no HTML); quando o radio profissional é marcado,
     .wrap:has() inverte qual variante de cada bloco aparece. Funciona
     mesmo com o toggle posicionado abaixo do conteúdo que ele afeta,
     porque :has() não depende de ordem no DOM, só de conter o elemento.

     Seletores compostos (span.for-pro, .feature.for-pro, li.for-pro) de
     propósito, em vez de um .for-pro genérico: a regra padrão de "esconder"
     precisa ganhar de .benefits li (que já define display:flex com a
     mesma especificidade de li.for-pro) - um .for-pro sozinho (uma classe
     só) perde essa disputa e o item vazava mostrado mesmo escondido.
     Cada tipo de elemento também recebe seu display correto ao reaparecer
     (inline pro texto trocado via both(), block pro card de feature, flex
     pro item de benefício) - um valor genérico quebraria o layout dos
     outros dois tipos. */
  span.for-pro, .feature.for-pro, li.for-pro { display: none; }
  .wrap:has(#aud-professional:checked) span.for-client,
  .wrap:has(#aud-professional:checked) .feature.for-client,
  .wrap:has(#aud-professional:checked) li.for-client { display: none; }
  .wrap:has(#aud-professional:checked) span.for-pro { display: inline; }
  .wrap:has(#aud-professional:checked) .feature.for-pro { display: block; }
  .wrap:has(#aud-professional:checked) li.for-pro { display: flex; }
`;

type Audience = "client" | "professional";
type WaitlistPageState = "form" | "success" | "error";

function both(client: string, professional: string): string {
  return `<span class="for-client">${client}</span><span class="for-pro">${professional}</span>`;
}

export function renderWaitlistPage(params: {
  count: number;
  utmSource?: string;
  state: WaitlistPageState;
}): string {
  const { count, utmSource, state } = params;

  const proof =
    count >= SOCIAL_PROOF_MIN_COUNT
      ? `<p class="proof">Junte-se a ${count} pessoas que já garantiram o lugar</p>`
      : `<p class="proof">Seja um dos primeiros a garantir o seu</p>`;

  const utmField = utmSource
    ? `<input type="hidden" name="utmSource" value="${escapeHtmlAttr(utmSource)}" />`
    : "";

  const errorBox =
    state === "error"
      ? `<div class="error-box">Ih, algo não saiu como esperado. Dá uma conferida no e-mail e tenta de novo?</div>`
      : "";

  const formOrSuccess =
    state === "success"
      ? `
        <div class="success-box">
          <div class="check">&#10003;</div>
          <h2 style="margin:0 0 8px;">Prontinho, você está dentro!</h2>
          <p style="color:var(--text2);margin:0;">
            ${both(
              "Fica de olho no seu e-mail — assim que abrirmos as portas, você é um dos primeiros a saber.",
              "Fica de olho no seu e-mail — vamos te chamar assim que abrirmos o cadastro de profissionais, com a condição especial de quem chegou cedo."
            )}
          </p>
        </div>
      `
      : `
        ${errorBox}
        <form action="/waitlist" method="POST">
          <div class="toggle">
            <input type="radio" id="aud-client" name="audience" value="CLIENT" checked />
            <label for="aud-client">Sou aluno</label>
            <input type="radio" id="aud-professional" name="audience" value="PROFESSIONAL" />
            <label for="aud-professional">Sou profissional</label>
          </div>
          <input type="email" name="email" placeholder="Seu melhor e-mail" required maxlength="254" />
          <input type="text" name="name" placeholder="Seu nome (opcional)" maxlength="120" />
          <div class="optional-row">
            <input type="tel" name="whatsapp" placeholder="WhatsApp (opcional)" maxlength="20" />
            <input type="text" name="city" placeholder="Cidade (opcional)" maxlength="120" />
          </div>
          ${utmField}
          <button type="submit" class="cta">${both("Quero entrar na lista", "Quero garantir meu lugar")}</button>
        </form>
        ${proof}
      `;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Muvify — Lista de Espera</title>
<meta name="description" content="Conecte. Evolua. Entre na lista de espera do Muvify e seja um dos primeiros a acessar." />
<link rel="stylesheet" href="/waitlist.css" />
</head>
<body>
  <div class="wrap">
    <div class="logo">muvi<span>fy</span></div>

    <div class="hero">
      <p class="kicker">${both("Pra quem treina", "Pra quem ensina")}</p>
      <h1>Conecte. <span class="accent">Evolua.</span></h1>
      <p class="sub">
        ${both(
          "Cansou de procurar personal no boca a boca? A gente te ajuda a encontrar o profissional certo, agendar em segundos e acompanhar cada resultado — tudo num só lugar. Entra na lista e seja um dos primeiros a testar.",
          "Menos tempo perdido organizando agenda e cobrança, mais tempo treinando quem importa. O Muvify junta seus alunos, pagamentos e divulgação num só app. Entra na lista e seja um dos primeiros profissionais a usar."
        )}
      </p>
    </div>

    <div class="card">
      ${formOrSuccess}
    </div>

    <section>
      <h2>O que é o Muvify</h2>
      <div class="grid3">
        <div class="feature for-client">
          <div class="icon">&#128269;</div>
          <h3>Encontre seu par ideal</h3>
          <p>Personal, fisio e nutri perto de você, com avaliação de quem já treinou.</p>
        </div>
        <div class="feature for-pro">
          <div class="icon">&#128226;</div>
          <h3>Apareça pra mais alunos</h3>
          <p>Seu perfil na frente de quem já está procurando o que você oferece.</p>
        </div>
        <div class="feature for-client">
          <div class="icon">&#9889;</div>
          <h3>Agende sem enrolação</h3>
          <p>Marca, remarca e paga direto pelo app — chega de ida e volta no WhatsApp.</p>
        </div>
        <div class="feature for-pro">
          <div class="icon">&#128197;</div>
          <h3>Agenda e cobrança no automático</h3>
          <p>O aluno agenda e paga sozinho — você só aparece e treina.</p>
        </div>
        <div class="feature for-client">
          <div class="icon">&#128200;</div>
          <h3>Veja sua evolução</h3>
          <p>Treinos, conquistas e resultados registrados sozinhos, sem esforço.</p>
        </div>
        <div class="feature for-pro">
          <div class="icon">&#128202;</div>
          <h3>Sua carteira de alunos organizada</h3>
          <p>Fichas, evolução e histórico de cada aluno, tudo num painel só.</p>
        </div>
      </div>
    </section>

    <section>
      <h2>Por que entrar na lista?</h2>
      <ul class="benefits">
        <li><span class="check-mark">&#10003;</span> <span><b>Acesso antecipado</b> — você testa antes de todo mundo.</span></li>
        <li><span class="check-mark">&#10003;</span> <span><b>Vantagens exclusivas</b> reservadas pra quem chegou cedo.</span></li>
        <li class="for-client"><span class="check-mark">&#10003;</span> <span><b>Sua opinião conta</b> — você ajuda a moldar o app antes do lançamento pra todo mundo.</span></li>
        <li class="for-pro"><span class="check-mark">&#10003;</span> <span><b>Taxa de lançamento reduzida</b> — condição especial pra quem entrar na plataforma cedo.</span></li>
      </ul>
    </section>
  </div>

  <footer>
    <!-- TODO: trocar pelos links reais das redes sociais do Muvify -->
    <a href="#">Instagram</a>
    <a href="#">YouTube</a>
    <p style="margin-top:14px;">Feito com carinho pela equipe Muvify &middot; &copy; ${new Date().getFullYear()}</p>
  </footer>
</body>
</html>`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
