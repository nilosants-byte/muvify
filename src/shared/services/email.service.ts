import { StatusCodes } from "http-status-codes";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env";
import { AppError } from "../errors/app-error";

function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]/g, " ").trim();
}

type EmailVerificationInput = {
  to: string;
  name: string;
  verificationUrl: string;
};

type PasswordResetEmailInput = {
  to: string;
  name: string;
  resetToken: string;
};

type PasswordChangedEmailInput = {
  to: string;
  name: string;
};

type DataExportConfirmationEmailInput = {
  to: string;
  name: string;
};

type AccountDeletedEmailInput = {
  to: string;
  name: string;
};

type RecoveryEmailUpdatedInput = {
  to: string;
  name: string;
  recoveryEmail: string;
};

type SupportMessageEmailInput = {
  to: string;
  userName: string;
  userEmail: string;
  userRole: string;
  subject: string;
  message: string;
  recoveryEmail?: string | null;
};

type SupportReplyEmailInput = {
  to: string;
  userName: string;
  subject?: string | null;
  responseMessage: string;
};

type CrefReviewEmailInput = {
  to: string;
  userName: string;
  approved: boolean;
  justification?: string | null;
};

type BookingConfirmationClientInput = {
  to: string;
  clientName: string;
  providerName: string;
  scheduledAt: Date;
  categoryName: string;
  priceCents: number;
};

type BookingConfirmationProviderInput = {
  to: string;
  providerName: string;
  clientName: string;
  scheduledAt: Date;
  categoryName: string;
  priceCents: number;
};

let transporter: Transporter | null = null;

function isSmtpConfigured() {
  if (env.NODE_ENV === "test" && !env.SMTP_ENABLED_IN_TEST) {
    return false;
  }

  return (
    Boolean(env.SMTP_HOST?.trim()) &&
    Boolean(env.SMTP_PORT) &&
    Boolean(env.SMTP_USER?.trim()) &&
    Boolean(env.SMTP_PASS?.trim()) &&
    Boolean(env.SMTP_FROM?.trim())
  );
}

function getTransporter() {
  if (!isSmtpConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED
      }
    });
  }

  return transporter;
}

function requireMailer() {
  const mailer = getTransporter();
  if (!mailer) {
    throw new AppError(
      "Servico de e-mail nao configurado. Tente novamente mais tarde.",
      StatusCodes.SERVICE_UNAVAILABLE
    );
  }
  return mailer;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailLayout(body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body{margin:0;padding:0;background-color:#f0f0f0;font-family:'Helvetica Neue',Arial,sans-serif;}
    .wrapper{max-width:580px;margin:32px auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10);}
    .header{background-color:#111827;padding:28px 32px;text-align:center;}
    .logo{color:#4CAF50;font-size:28px;font-weight:800;letter-spacing:3px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;}
    .logo span{color:#ffffff;}
    .body{padding:36px 32px 28px;}
    h2{margin:0 0 18px;font-size:20px;color:#111827;font-weight:700;}
    p{margin:0 0 14px;line-height:1.65;font-size:15px;color:#374151;}
    .btn{display:inline-block;margin:8px 0 24px;padding:14px 36px;background-color:#4CAF50;color:#ffffff !important;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px;}
    .btn-secondary{background-color:#374151;}
    .info-box{background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:16px 0;}
    .info-box p{margin:0;font-size:14px;color:#6b7280;}
    .divider{border:none;border-top:1px solid #e5e7eb;margin:24px 0;}
    .small{font-size:13px;color:#9ca3af;line-height:1.5;}
    .security-note{font-size:13px;color:#6b7280;background:#fff7ed;border-left:3px solid #f97316;padding:10px 14px;border-radius:0 6px 6px 0;margin-top:16px;}
    .footer{padding:20px 32px;text-align:center;font-size:12px;color:#9ca3af;background-color:#f9fafb;border-top:1px solid #e5e7eb;line-height:1.6;}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo">muvi<span>fy</span></div>
    </div>
    <div class="body">
      ${body}
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Muvify &mdash; Todos os direitos reservados<br>
      Este e-mail foi enviado automaticamente. Por favor, n&atilde;o responda.
    </div>
  </div>
</body>
</html>`;
}

// Épico de Frentes, Frente 9, Lote 19: nenhum template deste serviço tem
// mecanismo de opt-out (unsubscribe). Documentado como aceitável hoje -
// todo template existente é transacional/de segurança (verificação de
// conta, redefinição de senha, aviso de troca de senha, e-mail de
// recuperação alterado), nunca marketing. Se um template de marketing for
// adicionado no futuro, opt-out deixa de ser opcional (CAN-SPAM/LGPD).
export class EmailService {
  canSendEmail() {
    return isSmtpConfigured();
  }

  async verifyConnection() {
    if (!this.canSendEmail()) {
      return;
    }
    const mailer = requireMailer();
    await mailer.verify();
  }

  async sendEmailVerificationEmail(input: EmailVerificationInput) {
    const mailer = requireMailer();
    const expiresHours = env.EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS;

    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: "Muvify — Confirme seu e-mail",
      text: [
        `Ola, ${input.name}!`,
        "",
        "Obrigado por se cadastrar no Muvify.",
        "Para ativar sua conta, confirme seu e-mail clicando no link abaixo:",
        "",
        input.verificationUrl,
        "",
        `Este link expira em ${expiresHours} horas.`,
        "Se voce nao criou esta conta, ignore este e-mail."
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>Confirme seu e-mail</h2>
        <p>Ola, <strong>${escapeHtml(input.name)}</strong>! Bem-vindo(a) ao Muvify.</p>
        <p>Para ativar sua conta e come&ccedil;ar a usar o aplicativo, clique no bot&atilde;o abaixo:</p>
        <p>
          <a class="btn" href="${input.verificationUrl}" target="_blank" rel="noreferrer">
            Confirmar e-mail
          </a>
        </p>
        <div class="info-box">
          <p>&#128274; Este link expira em <strong>${expiresHours} horas</strong> e s&oacute; pode ser usado uma vez.</p>
        </div>
        <hr class="divider">
        <p class="small">Se o bot&atilde;o n&atilde;o funcionar, copie e cole este link no seu navegador:</p>
        <p class="small"><a href="${input.verificationUrl}" style="color:#4CAF50;word-break:break-all;">${input.verificationUrl}</a></p>
        <div class="security-note">
          Se voc&ecirc; n&atilde;o se cadastrou no Muvify, ignore este e-mail. Nenhuma a&ccedil;&atilde;o &eacute; necess&aacute;ria.
        </div>
      `)
    });
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput) {
    const mailer = requireMailer();
    const resetUrl = `${env.PASSWORD_RESET_WEB_URL}?token=${encodeURIComponent(input.resetToken)}`;
    const expiresMinutes = env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES;

    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: "Muvify — Redefinicao de senha",
      text: [
        `Ola, ${input.name}!`,
        "",
        "Recebemos uma solicitacao para redefinir a senha da sua conta no Muvify.",
        "Clique no link abaixo para criar uma nova senha:",
        "",
        resetUrl,
        "",
        `Este link expira em ${expiresMinutes} minutos.`,
        "Se voce nao solicitou a redefinicao, ignore este e-mail. Sua senha nao sera alterada."
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>Redefini&ccedil;&atilde;o de senha</h2>
        <p>Ola, <strong>${escapeHtml(input.name)}</strong>!</p>
        <p>Recebemos uma solicita&ccedil;&atilde;o para redefinir a senha da sua conta no Muvify. Clique no bot&atilde;o abaixo para criar uma nova senha:</p>
        <p>
          <a class="btn" href="${resetUrl}" target="_blank" rel="noreferrer">
            Redefinir minha senha
          </a>
        </p>
        <div class="info-box">
          <p>&#9201; Este link expira em <strong>${expiresMinutes} minutos</strong> e s&oacute; pode ser usado uma vez.</p>
        </div>
        <hr class="divider">
        <p class="small">Se o bot&atilde;o n&atilde;o funcionar, copie e cole este link no seu navegador:</p>
        <p class="small"><a href="${resetUrl}" style="color:#4CAF50;word-break:break-all;">${resetUrl}</a></p>
        <div class="security-note">
          Se voc&ecirc; n&atilde;o solicitou a redefini&ccedil;&atilde;o de senha, ignore este e-mail. Sua senha continuar&aacute; a mesma.
        </div>
      `)
    });
  }

  async sendPasswordChangedEmail(input: PasswordChangedEmailInput) {
    const mailer = requireMailer();
    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: "Muvify — Sua senha foi alterada",
      text: [
        `Ola, ${input.name}!`,
        "",
        "Sua senha foi alterada com sucesso no aplicativo Muvify.",
        "Se voce nao reconhece esta alteracao, entre em contato com o suporte imediatamente."
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>Senha alterada com sucesso</h2>
        <p>Ola, <strong>${escapeHtml(input.name)}</strong>!</p>
        <p>Sua senha foi alterada com sucesso no aplicativo <strong>Muvify</strong>.</p>
        <div class="security-note">
          &#9888; Se voc&ecirc; n&atilde;o realizou esta altera&ccedil;&atilde;o, entre em contato com o nosso suporte imediatamente pelo aplicativo.
        </div>
      `)
    });
  }

  // Épico de Frentes, Frente 11, Lote 5: exportação self-service de dados
  // pessoais não avisava o titular por nenhum canal - só o download em si.
  async sendDataExportConfirmation(input: DataExportConfirmationEmailInput) {
    const mailer = requireMailer();
    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: "Muvify — Seus dados foram exportados",
      text: [
        `Ola, ${input.name}!`,
        "",
        "Uma exportacao dos seus dados pessoais foi gerada agora no aplicativo Muvify.",
        "Se voce nao solicitou esta exportacao, entre em contato com o nosso suporte imediatamente."
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>Seus dados foram exportados</h2>
        <p>Ola, <strong>${escapeHtml(input.name)}</strong>!</p>
        <p>Uma exporta&ccedil;&atilde;o dos seus dados pessoais foi gerada agora no aplicativo <strong>Muvify</strong>.</p>
        <div class="security-note">
          &#9888; Se voc&ecirc; n&atilde;o solicitou esta exporta&ccedil;&atilde;o, entre em contato com o nosso suporte imediatamente pelo aplicativo.
        </div>
      `)
    });
  }

  // Épico de Frentes, Frente 11, Lote 6: excluir a conta nunca enviava
  // nenhum aviso de confirmação - o único sinal pro titular era o próprio
  // app deslogar.
  async sendAccountDeleted(input: AccountDeletedEmailInput) {
    const mailer = requireMailer();
    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: "Muvify — Sua conta foi excluída",
      text: [
        `Ola, ${input.name}!`,
        "",
        "Sua conta no aplicativo Muvify foi excluida com sucesso, conforme solicitado.",
        "Se voce nao solicitou esta exclusao, entre em contato com o nosso suporte imediatamente."
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>Sua conta foi excluída</h2>
        <p>Ola, <strong>${escapeHtml(input.name)}</strong>!</p>
        <p>Sua conta no aplicativo <strong>Muvify</strong> foi exclu&iacute;da com sucesso, conforme solicitado.</p>
        <div class="security-note">
          &#9888; Se voc&ecirc; n&atilde;o solicitou esta exclus&atilde;o, entre em contato com o nosso suporte imediatamente.
        </div>
      `)
    });
  }

  async sendRecoveryEmailUpdated(input: RecoveryEmailUpdatedInput) {
    const mailer = requireMailer();
    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: "Muvify — E-mail de recuperacao atualizado",
      text: [
        `Ola, ${input.name}!`,
        "",
        `Seu e-mail de recuperacao foi definido como: ${input.recoveryEmail}.`,
        "Se voce nao reconhece esta acao, revise as configuracoes de seguranca do aplicativo."
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>E-mail de recupera&ccedil;&atilde;o atualizado</h2>
        <p>Ola, <strong>${escapeHtml(input.name)}</strong>!</p>
        <p>Seu e-mail de recupera&ccedil;&atilde;o foi atualizado para:</p>
        <div class="info-box">
          <p>&#128231; <strong>${escapeHtml(input.recoveryEmail)}</strong></p>
        </div>
        <div class="security-note">
          Se voc&ecirc; n&atilde;o realizou esta altera&ccedil;&atilde;o, acesse as configura&ccedil;&otilde;es de seguran&ccedil;a no aplicativo.
        </div>
      `)
    });
  }

  async sendSupportMessageEmail(input: SupportMessageEmailInput) {
    const mailer = requireMailer();
    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      replyTo: input.userEmail,
      subject: `[Suporte Muvify] ${sanitizeSubject(input.subject)}`,
      text: [
        "Nova solicitacao de suporte recebida pelo app.",
        "",
        `Nome: ${input.userName}`,
        `E-mail da conta: ${input.userEmail}`,
        `Papel no app: ${input.userRole}`,
        `E-mail de recuperacao: ${input.recoveryEmail ?? "nao definido"}`,
        "",
        "Mensagem:",
        input.message
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>&#128203; Nova solicita&ccedil;&atilde;o de suporte</h2>
        <div class="info-box">
          <p><strong>Nome:</strong> ${escapeHtml(input.userName)}</p>
          <p><strong>E-mail da conta:</strong> ${escapeHtml(input.userEmail)}</p>
          <p><strong>Papel no app:</strong> ${escapeHtml(input.userRole)}</p>
          <p><strong>E-mail de recupera&ccedil;&atilde;o:</strong> ${escapeHtml(input.recoveryEmail ?? "nao definido")}</p>
        </div>
        <hr class="divider">
        <p><strong>Mensagem:</strong></p>
        <p style="white-space:pre-wrap;background:#f9fafb;padding:14px;border-radius:8px;font-size:14px;">${escapeHtml(input.message)}</p>
      `)
    });
  }

  async sendSupportReplyEmail(input: SupportReplyEmailInput) {
    const mailer = requireMailer();
    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: `[Suporte Muvify] Resposta: ${sanitizeSubject(input.subject ?? "Sua solicitacao")}`,
      text: [
        `Ola, ${input.userName}!`,
        "",
        "Seu chamado de suporte foi respondido:",
        input.responseMessage
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>Resposta ao seu chamado de suporte</h2>
        <p>Ola, <strong>${escapeHtml(input.userName)}</strong>!</p>
        <p>Seu chamado de suporte foi respondido pela nossa equipe:</p>
        <div class="info-box">
          <p style="white-space:pre-wrap;">${escapeHtml(input.responseMessage)}</p>
        </div>
        <p class="small">Se precisar de mais ajuda, abra um novo chamado pelo aplicativo.</p>
      `)
    });
  }

  async sendBookingConfirmationToClient(input: BookingConfirmationClientInput) {
    const mailer = requireMailer();
    const dateStr = input.scheduledAt.toLocaleDateString("pt-BR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo"
    });
    const priceStr = (input.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: `Muvify — Agendamento solicitado com ${sanitizeSubject(input.providerName)}`,
      text: [
        `Ola, ${input.clientName}!`,
        "",
        `Seu agendamento com ${input.providerName} foi solicitado com sucesso.`,
        `Data e hora: ${dateStr}`,
        `Servico: ${input.categoryName}`,
        `Valor: ${priceStr}`,
        "",
        "Acompanhe o status pelo aplicativo e use o chat para tirar duvidas com seu personal."
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>&#9989; Agendamento solicitado!</h2>
        <p>Ola, <strong>${escapeHtml(input.clientName)}</strong>!</p>
        <p>Seu agendamento foi solicitado com sucesso. Confira os detalhes abaixo:</p>
        <div class="info-box">
          <p>&#127919; <strong>Personal:</strong> ${escapeHtml(input.providerName)}</p>
          <p>&#128197; <strong>Data e hora:</strong> ${escapeHtml(dateStr)}</p>
          <p>&#127977; <strong>Servi&ccedil;o:</strong> ${escapeHtml(input.categoryName)}</p>
          <p>&#128181; <strong>Valor:</strong> ${escapeHtml(priceStr)}</p>
        </div>
        <p>Acompanhe o status do agendamento pelo aplicativo. Use o <strong>chat</strong> para se apresentar e tirar d&uacute;vidas com seu personal!</p>
        <div class="security-note">
          Caso precise cancelar, fa&ccedil;a pelo aplicativo com anteced&ecirc;ncia.
        </div>
      `)
    });
  }

  async sendBookingConfirmationToProvider(input: BookingConfirmationProviderInput) {
    const mailer = requireMailer();
    const dateStr = input.scheduledAt.toLocaleDateString("pt-BR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo"
    });
    const priceStr = (input.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: `Muvify — Novo agendamento de ${sanitizeSubject(input.clientName)}`,
      text: [
        `Ola, ${input.providerName}!`,
        "",
        `Voce tem um novo agendamento solicitado por ${input.clientName}.`,
        `Data e hora: ${dateStr}`,
        `Servico: ${input.categoryName}`,
        `Valor: ${priceStr}`,
        "",
        "Acesse o aplicativo para ver os detalhes e o chat com o aluno."
      ].join("\n"),
      html: buildEmailLayout(`
        <h2>&#128197; Novo agendamento recebido!</h2>
        <p>Ola, <strong>${escapeHtml(input.providerName)}</strong>!</p>
        <p>Um novo agendamento foi solicitado. Veja os detalhes:</p>
        <div class="info-box">
          <p>&#128100; <strong>Aluno:</strong> ${escapeHtml(input.clientName)}</p>
          <p>&#128197; <strong>Data e hora:</strong> ${escapeHtml(dateStr)}</p>
          <p>&#127977; <strong>Servi&ccedil;o:</strong> ${escapeHtml(input.categoryName)}</p>
          <p>&#128181; <strong>Valor:</strong> ${escapeHtml(priceStr)}</p>
        </div>
        <p>Acesse o aplicativo para confirmar o agendamento e conversar com o aluno pelo <strong>chat</strong>.</p>
      `)
    });
  }

  async sendCrefReviewEmail(input: CrefReviewEmailInput) {
    const mailer = requireMailer();
    const approved = input.approved;
    const decisionLabel = approved ? "Aprovado" : "Reprovado";
    const reason =
      approved || !input.justification?.trim() ? null : input.justification.trim();

    const approvedBody = `
      <h2>&#127881; Seu CREF foi aprovado!</h2>
      <p>Ola, <strong>${escapeHtml(input.userName)}</strong>!</p>
      <p>Temos &oacute;timas not&iacute;cias: seu registro CREF foi <strong>validado</strong> pela nossa equipe.</p>
      <p>Sua conta profissional est&aacute; agora <strong>ativa</strong> e você j&aacute; pode receber clientes pelo Muvify.</p>
      <div class="info-box">
        <p>&#9989; Status: <strong>Aprovado</strong></p>
      </div>
      <p>Abra o aplicativo e configure seus hor&aacute;rios e &aacute;rea de atendimento para come&ccedil;ar!</p>
    `;

    const rejectedBody = `
      <h2>Revis&atilde;o do seu CREF</h2>
      <p>Ola, <strong>${escapeHtml(input.userName)}</strong>!</p>
      <p>Analisamos o seu registro CREF e, neste momento, ele n&atilde;o foi aprovado.</p>
      <div class="info-box">
        <p>&#10060; Status: <strong>N&atilde;o aprovado</strong></p>
        ${reason ? `<p><strong>Motivo informado:</strong> ${escapeHtml(reason)}</p>` : ""}
      </div>
      <p>Verifique os documentos enviados, fa&ccedil;a as corre&ccedil;&otilde;es necess&aacute;rias e envie novamente pelo aplicativo.</p>
      <div class="security-note">
        D&uacute;vidas? Entre em contato com o suporte pelo aplicativo.
      </div>
    `;

    await mailer.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: `Muvify — Revisao de CREF: ${sanitizeSubject(decisionLabel)}`,
      text: [
        `Ola, ${input.userName}!`,
        "",
        approved
          ? "Seu CREF foi aprovado e sua conta profissional foi liberada. Voce ja pode receber clientes pelo Muvify."
          : "Seu CREF nao foi aprovado no momento. Verifique os documentos e envie novamente.",
        ...(reason ? ["", `Motivo informado: ${reason}`] : [])
      ].join("\n"),
      html: buildEmailLayout(approved ? approvedBody : rejectedBody)
    });
  }
}
