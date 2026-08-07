import { BookingStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../../config/env";
import { prisma } from "../../../../config/prisma";
import { AppError } from "../../../../shared/errors/app-error";
import { sessionOverlapsRange } from "../../../../shared/utils/time-range";
import { toDateKeyInTimezone, toTimeInTimezone } from "../../../../shared/utils/timezone";

async function getProviderByUserId(userId: string) {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId },
    select: { id: true, sessionDurationMinutes: true },
  });
  if (!profile) {
    throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
  }
  return profile;
}

export class ManualBlockService {
  async list(userId: string) {
    const provider = await getProviderByUserId(userId);
    return prisma.providerManualBlock.findMany({
      where: { providerId: provider.id },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
  }

  async listByProviderId(providerId: string, dates?: string[]) {
    return prisma.providerManualBlock.findMany({
      where: {
        providerId,
        ...(dates && dates.length > 0 ? { date: { in: dates } } : {}),
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: { date: true, startTime: true, endTime: true },
    });
  }

  async create(
    userId: string,
    input: {
      date: string;
      startTime: string;
      endTime: string;
      label: string;
      location?: string;
    }
  ) {
    const provider = await getProviderByUserId(userId);
    const { date, startTime, endTime, label, location } = input;

    if (startTime >= endTime) {
      throw new AppError("Horário inicial deve ser menor que o final.");
    }

    return prisma.$transaction(async (tx) => {
      // Lock pessimista por provider+data para prevenir overlaps concorrentes
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`manualblock:${provider.id}:${date}`}))`;

      const existingBlocks = await tx.providerManualBlock.findMany({
        where: { providerId: provider.id, date },
      });
      const overlapBlock = existingBlocks.some(
        (b) => startTime < b.endTime && endTime > b.startTime
      );
      if (overlapBlock) {
        throw new AppError("Horário conflita com um bloqueio manual existente.", StatusCodes.CONFLICT);
      }

      const dayStartUtc = new Date(`${date}T00:00:00.000Z`);
      dayStartUtc.setUTCHours(dayStartUtc.getUTCHours() - 12);
      const dayEndUtc = new Date(`${date}T23:59:59.999Z`);
      dayEndUtc.setUTCHours(dayEndUtc.getUTCHours() + 12);

      const bookings = await tx.booking.findMany({
        where: {
          providerId: provider.id,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledAt: { gte: dayStartUtc, lte: dayEndUtc },
        },
        select: { scheduledAt: true },
      });

      // Frente 4 (segunda camada), Lote 3: antes só checava se o INÍCIO do
      // agendamento caía dentro da janela do novo bloqueio — um bloqueio
      // podia ser criado com sucesso mesmo invadindo os minutos finais de
      // uma sessão já confirmada que começou antes da janela do bloqueio.
      const overlapBooking = bookings.some((booking) => {
        const localDate = toDateKeyInTimezone(booking.scheduledAt, env.APP_TIMEZONE);
        if (localDate !== date) return false;
        const localTime = toTimeInTimezone(booking.scheduledAt, env.APP_TIMEZONE);
        return sessionOverlapsRange(localTime, provider.sessionDurationMinutes, startTime, endTime);
      });
      if (overlapBooking) {
        throw new AppError("Já existe um agendamento marcado neste horário.", StatusCodes.CONFLICT);
      }

      return tx.providerManualBlock.create({
        data: { providerId: provider.id, date, startTime, endTime, label, location },
      });
    });
  }

  async delete(userId: string, blockId: string) {
    const provider = await getProviderByUserId(userId);
    const block = await prisma.providerManualBlock.findUnique({
      where: { id: blockId },
      select: { id: true, providerId: true },
    });
    if (!block || block.providerId !== provider.id) {
      throw new AppError("Bloqueio não encontrado.", StatusCodes.NOT_FOUND);
    }
    await prisma.providerManualBlock.delete({ where: { id: blockId } });
  }
}
