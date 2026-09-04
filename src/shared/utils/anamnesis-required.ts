import { StatusCodes } from "http-status-codes";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { AppError } from "../errors/app-error";
import { isOnboardingGatesBypassActive } from "./onboarding-gates-bypass";

// Frente 8 (segunda camada), Lote 10: a mesma checagem (REQUIRE_ANAMNESIS_
// FOR_CONTRACTS + buscar ClientAnamnesis + exigir status COMPLETED) estava
// duplicada palavra por palavra em booking.service.ts, presential-package.
// service.ts e consultancy.service.ts — cada uma delas repetindo o mesmo
// bug em potencial de forma independente, se algum dia mudar.
export async function assertAnamnesisCompleted(clientId: string, actionMessage: string) {
  if (!env.REQUIRE_ANAMNESIS_FOR_CONTRACTS) return;
  if (isOnboardingGatesBypassActive()) return;
  const anamnesis = await prisma.clientAnamnesis.findUnique({ where: { clientId } });
  if (!anamnesis || anamnesis.status !== "COMPLETED") {
    throw new AppError(actionMessage, StatusCodes.BAD_REQUEST);
  }
}
