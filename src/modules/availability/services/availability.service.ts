import { BookingStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern } from "../../../shared/utils/cache";
import { assertProviderSubscriptionActive } from "../../../shared/utils/provider-subscription-gate";
import { toTimeInTimezone, toWeekdayInTimezone } from "../../../shared/utils/timezone";

export class AvailabilityService {
  async create(userId: string, weekday: number, startTime: string, endTime: string, isActive = true) {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId }
    });
    if (!profile) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }
    await assertProviderSubscriptionActive(profile.id);
    if (startTime >= endTime) {
      throw new AppError("Horário inicial deve ser menor que o final.");
    }
    const availability = await prisma.$transaction(async (tx) => {
      // Lock pessimista: impede dois creates simultâneos para o mesmo provider/weekday
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`avail:${profile.id}:${weekday}`}))`;

      const existing = await tx.availability.findMany({
        where: { providerId: profile.id, weekday, isActive: true }
      });
      const overlaps = existing.some(
        (item) => startTime < item.endTime && endTime > item.startTime
      );
      if (overlaps) {
        throw new AppError("Horário conflita com disponibilidade existente.");
      }
      return tx.availability.create({
        data: { providerId: profile.id, weekday, startTime, endTime, isActive }
      });
    });
    await deleteByPattern("providers:*");
    return availability;
  }
  async deleteAvailability(userId: string, availabilityId: string, force = false) {
    const profile = await prisma.providerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    await assertProviderSubscriptionActive(profile.id);
    const slot = await prisma.availability.findUnique({
      where: { id: availabilityId },
      select: { id: true, providerId: true, weekday: true, startTime: true, endTime: true }
    });
    if (!slot || slot.providerId !== profile.id) throw new AppError("Horário não encontrado.", StatusCodes.NOT_FOUND);

    // Frente 5 (Descoberta, agendamento e agenda), Lote 6: excluir uma
    // disponibilidade recorrente não verificava agendamentos futuros
    // marcados dentro daquele horário — diferente de ManualBlockService,
    // que já bloqueia a criação de um bloqueio nesse caso. Aviso não
    // bloqueante: só segue sem confirmação extra (force=true) se houver
    // agendamento futuro afetado.
    if (!force) {
      // Frente 6 (segunda camada), Lote 14: sem limite, destoando do padrão
      // já usado no resto do módulo (e do projeto em geral) pra evitar
      // listagem sem teto num profissional com histórico grande.
      const futureBookings = await prisma.booking.findMany({
        where: {
          providerId: profile.id,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledAt: { gt: new Date() }
        },
        select: { scheduledAt: true },
        take: 2000
      });
      const affectedCount = futureBookings.filter((booking) => {
        if (toWeekdayInTimezone(booking.scheduledAt, env.APP_TIMEZONE) !== slot.weekday) return false;
        const time = toTimeInTimezone(booking.scheduledAt, env.APP_TIMEZONE);
        return time >= slot.startTime && time < slot.endTime;
      }).length;
      if (affectedCount > 0) {
        throw new AppError(
          `Existe${affectedCount > 1 ? "m" : ""} ${affectedCount} agendamento${affectedCount > 1 ? "s" : ""} futuro${affectedCount > 1 ? "s" : ""} marcado${affectedCount > 1 ? "s" : ""} dentro desse horário. Confirme novamente se ainda quiser remover esta disponibilidade.`,
          StatusCodes.CONFLICT
        );
      }
    }

    await prisma.availability.delete({ where: { id: availabilityId } });
    await deleteByPattern("providers:*");
  }

  async listMyAvailability(userId: string) {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId },
      include: {
        availabilities: {
          orderBy: [{ weekday: "asc" }, { startTime: "asc" }]
        }
      }
    });
    if (!profile) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }
    return profile.availabilities;
  }
}
