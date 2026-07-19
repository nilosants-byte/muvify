import { prisma } from "../../config/prisma";
import { decryptSensitiveText } from "./encryption";

export async function resolveProviderMpAccessToken(providerId: string): Promise<string | null> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { mpAccessToken: true, mpAccountId: true }
  });
  if (!provider?.mpAccessToken || !provider.mpAccountId) return null;
  return decryptSensitiveText(provider.mpAccessToken);
}
