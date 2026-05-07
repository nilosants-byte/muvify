import { BookingStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../../config/env";
import { prisma } from "../../../../config/prisma";
import { AppError } from "../../../../shared/errors/app-error";

function toDateKeyInTimezone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function toTimeInTimezone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

async function getProviderByUserId(userId: string) {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId },
    select: { id: true },
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

    // Check overlap with existing manual blocks on the same date
    const existingBlocks = await prisma.providerManualBlock.findMany({
      where: { providerId: provider.id, date },
    });
    const overlapBlock = existingBlocks.some(
      (b) => startTime < b.endTime && endTime > b.startTime
    );
    if (overlapBlock) {
      throw new AppError(
        "Horário conflita com um bloqueio manual existente.",
        StatusCodes.CONFLICT
      );
    }

    // Check overlap with existing bookings on the same date (timezone-aware)
    // Use a generous UTC window around the local day to ensure we catch all bookings
    const dayStartUtc = new Date(`${date}T00:00:00.000Z`);
    dayStartUtc.setUTCHours(dayStartUtc.getUTCHours() - 12);
    const dayEndUtc = new Date(`${date}T23:59:59.999Z`);
    dayEndUtc.setUTCHours(dayEndUtc.getUTCHours() + 12);

    const bookings = await prisma.booking.findMany({
      where: {
        providerId: provider.id,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        scheduledAt: { gte: dayStartUtc, lte: dayEndUtc },
      },
      select: { scheduledAt: true },
    });

    const overlapBooking = bookings.some((booking) => {
      const localDate = toDateKeyInTimezone(booking.scheduledAt, env.APP_TIMEZONE);
      if (localDate !== date) return false;
      const localTime = toTimeInTimezone(booking.scheduledAt, env.APP_TIMEZONE);
      return localTime >= startTime && localTime < endTime;
    });
    if (overlapBooking) {
      throw new AppError(
        "Já existe um agendamento marcado neste horário.",
        StatusCodes.CONFLICT
      );
    }

    return prisma.providerManualBlock.create({
      data: { providerId: provider.id, date, startTime, endTime, label, location },
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
