import { BookingStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern } from "../../../shared/utils/cache";
import { assertProviderSubscriptionActive } from "../../../shared/utils/provider-subscription-gate";
import { toTimeInTimezone, toWeekdayInTimezone } from "../../../shared/utils/timezone";
import { BookingService } from "../../bookings/services/booking.service";

const bookingService = new BookingService();

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
  async deleteAvailability(
    userId: string,
    availabilityId: string,
    force = false,
    cancelBookings = false
  ) {
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
    // Frente 6 (segunda camada), Lote 14: sem limite, destoando do padrão
    // já usado no resto do módulo (e do projeto em geral) pra evitar
    // listagem sem teto num profissional com histórico grande.
    const futureBookings = await prisma.booking.findMany({
      where: {
        providerId: profile.id,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        scheduledAt: { gt: new Date() }
      },
      select: { id: true, scheduledAt: true },
      take: 2000
    });
    const affectedBookings = futureBookings.filter((booking) => {
      if (toWeekdayInTimezone(booking.scheduledAt, env.APP_TIMEZONE) !== slot.weekday) return false;
      const time = toTimeInTimezone(booking.scheduledAt, env.APP_TIMEZONE);
      return time >= slot.startTime && time < slot.endTime;
    });

    if (!force && affectedBookings.length > 0) {
      const affectedCount = affectedBookings.length;
      throw new AppError(
        `Existe${affectedCount > 1 ? "m" : ""} ${affectedCount} agendamento${affectedCount > 1 ? "s" : ""} futuro${affectedCount > 1 ? "s" : ""} marcado${affectedCount > 1 ? "s" : ""} dentro desse horário. Confirme novamente se ainda quiser remover esta disponibilidade.`,
        StatusCodes.CONFLICT
      );
    }

    // force=true por si só nunca mexe nos agendamentos já marcados -- só
    // remove o horário-modelo recorrente (novos agendamentos deixam de
    // poder ser feitos nele; os já existentes continuam confirmados
    // normalmente). cancelBookings=true é a escolha explícita e adicional
    // de também cancelar (com reembolso integral, mesma regra de sempre
    // quando é o profissional que cancela) cada sessão futura afetada.
    // Best-effort por item, igual ao padrão já usado em
    // cancelActiveStandaloneBookingsForProviderRemoval: uma falha isolada
    // não deve impedir as demais nem a remoção do horário.
    if (force && cancelBookings && affectedBookings.length > 0) {
      for (const booking of affectedBookings) {
        await bookingService
          .updateStatus(userId, booking.id, BookingStatus.CANCELLED)
          .catch((error) =>
            console.error(`Falha ao cancelar agendamento ${booking.id} ao remover disponibilidade ${availabilityId}:`, error)
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
