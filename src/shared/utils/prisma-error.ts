import { Prisma } from "@prisma/client";

export function isPrismaKnownRequestError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export function isPrismaDatabaseUnavailableError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  if (!isPrismaKnownRequestError(error)) {
    return false;
  }
  return error.code === "P1001" || error.code === "P1002";
}
