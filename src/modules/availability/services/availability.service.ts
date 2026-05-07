import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../shared/errors/app-error";
import { deleteByPattern } from "../../../shared/utils/cache";
export class AvailabilityService {
  async create(userId: string, weekday: number, startTime: string, endTime: string, isActive = true) {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId }
    });
    if (!profile) {
      throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    }
    if (startTime >= endTime) {
      throw new AppError("Horário inicial deve ser menor que o final.");
    }
    const existing = await prisma.availability.findMany({
      where: {
        providerId: profile.id,
        weekday,
        isActive: true
      }
    });
    const overlaps = existing.some(
      (item) => startTime < item.endTime && endTime > item.startTime
    );
    if (overlaps) {
      throw new AppError("Horário conflita com disponibilidade existente.");
    }
    const availability = await prisma.availability.create({
      data: {
        providerId: profile.id,
        weekday,
        startTime,
        endTime,
        isActive
      }
    });
    await deleteByPattern("providers:*");
    return availability;
  }
  async deleteAvailability(userId: string, availabilityId: string) {
    const profile = await prisma.providerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new AppError("Perfil profissional não encontrado.", StatusCodes.NOT_FOUND);
    const slot = await prisma.availability.findUnique({ where: { id: availabilityId }, select: { id: true, providerId: true } });
    if (!slot || slot.providerId !== profile.id) throw new AppError("Horário não encontrado.", StatusCodes.NOT_FOUND);
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
