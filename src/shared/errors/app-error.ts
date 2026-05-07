import { StatusCodes } from "http-status-codes";
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  constructor(message: string, statusCode = StatusCodes.BAD_REQUEST, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}
