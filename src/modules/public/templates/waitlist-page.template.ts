// Landing page pública de lista de espera pré-lançamento. Vive aqui (mesmo
// backend, sem prefixo /api) pelo mesmo motivo já documentado em
// public.routes.ts:6-11 pras páginas legais: não há domínio de marketing
// dedicado ainda — assim que um DNS apontar pra este backend, /lista-espera
// já funciona, sem nenhuma mudança de código.
//
// Sem JavaScript obrigatório: formulário HTML puro, POST + redirect
// (padrão Post/Redirect/Get). O toggle "Sou aluno" / "Sou profissional" é
// um par de radio nativos estilizado só com CSS (:checked) — funciona sem
// JS, então a fricção de cadastro não depende do navegador do visitante
// ter JS habilitado (raro, mas landing pages de campanha em vídeo recebem
// tráfego de todo tipo de navegador embutido).
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
`;

type WaitlistPageState = "form" | "success" | "error";

export function renderWaitlistPage(params: {
  count: number;
  utmSource?: string;
  state: WaitlistPageState;
}): string {
  const { count, utmSource, state } = params;

  const proof =
    count >= SOCIAL_PROOF_MIN_COUNT
      ? `<p class="proof">Junte-se a ${count} pessoas na frente</p>`
      : `<p class="proof">Seja um dos primeiros a entrar</p>`;

  const utmField = utmSource
    ? `<input type="hidden" name="utmSource" value="${escapeHtmlAttr(utmSource)}" />`
    : "";

  const errorBox =
    state === "error"
      ? `<div class="error-box">Não deu pra concluir o cadastro — confira o e-mail digitado e tente de novo.</div>`
      : "";

  const formOrSuccess =
    state === "success"
      ? `
        <div class="success-box">
          <div class="check">&#10003;</div>
          <h2 style="margin:0 0 8px;">Você entrou!</h2>
          <p style="color:var(--text2);margin:0;">Fique de olho no seu e-mail — te avisamos assim que o Muvify estiver disponível.</p>
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
          <div class="optional-row">
            <input type="tel" name="whatsapp" placeholder="WhatsApp (opcional)" maxlength="20" />
            <input type="text" name="city" placeholder="Cidade (opcional)" maxlength="120" />
          </div>
          ${utmField}
          <button type="submit" class="cta">Entrar na Lista de Espera</button>
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
      <h1>Conecte. <span class="accent">Evolua.</span></h1>
      <p class="sub">O primeiro app que conecta você aos melhores profissionais de fitness perto de você. Entre na lista de espera e seja um dos primeiros a acessar.</p>
    </div>

    <div class="card">
      ${formOrSuccess}
    </div>

    <section>
      <h2>O que é o Muvify</h2>
      <div class="grid3">
        <div class="feature">
          <div class="icon">&#128269;</div>
          <h3>Encontre Profissionais</h3>
          <p>Personal, fisio e nutri perto de você.</p>
        </div>
        <div class="feature">
          <div class="icon">&#9889;</div>
          <h3>Agende em 1 clique</h3>
          <p>Direto pelo app, sem trocar mensagem no WhatsApp.</p>
        </div>
        <div class="feature">
          <div class="icon">&#128200;</div>
          <h3>Acompanhe sua evolução</h3>
          <p>Treinos, conquistas e resultados num só lugar.</p>
        </div>
      </div>
    </section>

    <section>
      <h2>Por que entrar na lista?</h2>
      <ul class="benefits">
        <li><span class="check-mark">&#10003;</span> <span><b>Acesso antecipado</b> — antes de todo mundo.</span></li>
        <li><span class="check-mark">&#10003;</span> <span><b>Benefícios exclusivos</b> pros primeiros usuários.</span></li>
        <li><span class="check-mark">&#10003;</span> <span><b>Bônus de lançamento</b> — vale tanto pra quem quer treinar quanto pra quem é profissional.</span></li>
      </ul>
    </section>
  </div>

  <footer>
    <!-- TODO: trocar pelos links reais das redes sociais do Muvify -->
    <a href="#">Instagram</a>
    <a href="#">YouTube</a>
    <p style="margin-top:14px;">&copy; ${new Date().getFullYear()} Muvify</p>
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
