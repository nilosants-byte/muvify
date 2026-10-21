import { StatusCodes } from "http-status-codes";
import { prisma } from "../../config/prisma";
import { AppError } from "../errors/app-error";
import { decryptSensitiveText } from "./encryption";

// Raio-X de pagamentos, Rodada 2, Lote 1: mpTokenInvalidatedAt (marcado por
// refreshProviderMpTokens quando a renovação falha) agora é checado aqui,
// centralizado — antes só chargeFichaRenewal tinha essa guarda, deixando os
// outros 6+ pontos de cobrança vulneráveis a cobrar sem split se o token
// estivesse tecnicamente presente mas já invalidado.
export async function resolveProviderMpAccessToken(providerId: string): Promise<string | null> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { mpAccessToken: true, mpAccountId: true, mpTokenInvalidatedAt: true }
  });
  if (!provider?.mpAccessToken || !provider.mpAccountId || provider.mpTokenInvalidatedAt) return null;
  return decryptSensitiveText(provider.mpAccessToken);
}

// Variante que nunca deixa uma cobrança prosseguir sem token resolvido — usar
// em todo fluxo de cobrança interativo (disparado por uma ação do cliente ou
// do profissional na hora), pra nunca cair no fallback "cobra sem split".
export async function requireProviderMpAccessToken(providerId: string): Promise<string> {
  const token = await resolveProviderMpAccessToken(providerId);
  if (!token) {
    throw new AppError(
      "Não foi possível processar o pagamento — a conexão deste profissional com o Mercado Pago precisa ser reconectada. Peça para ele acessar Recebimentos e reconectar a conta.",
      StatusCodes.BAD_REQUEST
    );
  }
  return token;
}

// Token da conta dona de um pagamento já criado (pra consultar, capturar,
// cancelar ou estornar). Sem personal, ou personal desconectado → null
// (conta da plataforma). Ver mpConfigFor em config/mercadopago.ts.
export async function mpTokenForProvider(providerId: string | null | undefined): Promise<string | null> {
  if (!providerId) return null;
  return resolveProviderMpAccessToken(providerId);
}

// Webhook: o aviso do Mercado Pago só traz o id do pagamento — descobre de
// qual personal ele é (se for) pra consultar com a conta certa.
export async function findProviderIdForMpPayment(mpPaymentId: string): Promise<string | null> {
  const [payment, contract, pkgPending, plan, cycle, debt] = await Promise.all([
    prisma.payment.findFirst({ where: { mpPaymentId }, select: { booking: { select: { providerId: true } } } }),
    prisma.consultancyContract.findFirst({ where: { mpPaymentId }, select: { providerId: true } }),
    prisma.presentialPackage.findFirst({ where: { pendingChargeMpPaymentId: mpPaymentId }, select: { providerId: true } }),
    prisma.trainingPlan.findFirst({ where: { renewalMpPaymentId: mpPaymentId }, select: { contract: { select: { providerId: true } } } }),
    prisma.presentialPackageCycle.findFirst({ where: { mpPaymentId }, select: { package: { select: { providerId: true } } } }),
    prisma.debtRecord.findFirst({
      where: { OR: [{ pendingPixMpPaymentId: mpPaymentId }, { mpPaymentId }], debtorType: "CLIENT" },
      select: { providerId: true }
    })
  ]);
  return (
    payment?.booking?.providerId ??
    contract?.providerId ??
    pkgPending?.providerId ??
    plan?.contract?.providerId ??
    cycle?.package?.providerId ??
    debt?.providerId ??
    null
  );
}
