import { BookingStatus } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BookingService } from "../services/booking.service";
const bookingService = new BookingService();
export class BookingController {
  async create(request: Request, response: Response) {
    const booking = await bookingService.create(
      request.user!.id,
      request.body.providerId,
      request.body.categoryId,
      request.body.scheduledAt,
      request.body.offerId,
      request.body.paymentMethod,
      request.body.notes,
      request.body.sessionLocation,
      request.body.clientLatitude,
      request.body.clientLongitude,
      request.body.packageId
    );
    return response.status(StatusCodes.CREATED).json(booking);
  }
  async listMyBookings(request: Request, response: Response) {
    const skip = request.query.skip ? Math.max(0, Number(request.query.skip)) : 0;
    const take = request.query.take ? Math.min(100, Math.max(1, Number(request.query.take))) : 50;
    const bookings = await bookingService.listMyBookings(request.user!.id, skip, take);
    return response.json(bookings);
  }
  async updateStatus(request: Request, response: Response) {
    const booking = await bookingService.updateStatus(
      request.user!.id,
      request.params.bookingId,
      request.body.status as BookingStatus,
      request.body.completionProof
    );
    return response.json(booking);
  }

  async getAttendanceCode(request: Request, response: Response) {
    const payload = await bookingService.getAttendanceCode(
      request.user!.id,
      request.params.bookingId
    );
    return response.json(payload);
  }

  async verifyAttendanceCode(request: Request, response: Response) {
    const payload = await bookingService.verifyAttendanceCode(
      request.user!.id,
      request.params.bookingId,
      request.body.code
    );
    return response.json(payload);
  }

  async verifyAttendanceQr(request: Request, response: Response) {
    const payload = await bookingService.verifyAttendanceQr(
      request.user!.id,
      request.params.bookingId,
      request.body.qrToken
    );
    return response.json(payload);
  }

  async reportNoShow(request: Request, response: Response) {
    const booking = await bookingService.reportNoShow(request.user!.id, request.params.bookingId);
    return response.json(booking);
  }

  async contestNoShowReport(request: Request, response: Response) {
    const report = await bookingService.contestNoShowReport(request.user!.id, request.params.bookingId);
    return response.json(report);
  }

  async getCompletionProofImage(request: Request, response: Response) {
    const { buffer, mimeType } = await bookingService.getCompletionProofImage(
      request.user!.id,
      request.params.bookingId,
      request.params.evidenceUserId
    );
    response.setHeader("Cache-Control", "private, no-store");
    return response.type(mimeType).send(buffer);
  }
}
