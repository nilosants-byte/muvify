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
