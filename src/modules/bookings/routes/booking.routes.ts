import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { BookingController } from "../controllers/booking.controller";
import {
  bookingIdParamSchema,
  createBookingSchema,
  updateBookingStatusSchema,
  verifyAttendanceCodeSchema,
  verifyAttendanceQrSchema
} from "../validators/booking.validator";
const bookingController = new BookingController();
export const bookingRoutes = Router();
bookingRoutes.use(ensureAuthenticated);

const clientOrProvider = ensureRole(UserRole.CLIENT, UserRole.PROVIDER);

bookingRoutes.get("/me", clientOrProvider, bookingController.listMyBookings);
bookingRoutes.post("/", clientOrProvider, validate(createBookingSchema), bookingController.create);
bookingRoutes.get(
  "/:bookingId/attendance-code",
  clientOrProvider,
  validate(bookingIdParamSchema),
  bookingController.getAttendanceCode
);
bookingRoutes.post(
  "/:bookingId/attendance-code/verify",
  clientOrProvider,
  validate(verifyAttendanceCodeSchema),
  bookingController.verifyAttendanceCode
);
bookingRoutes.post(
  "/:bookingId/attendance-code/verify-qr",
  clientOrProvider,
  validate(verifyAttendanceQrSchema),
  bookingController.verifyAttendanceQr
);
bookingRoutes.patch("/:bookingId/status", clientOrProvider, uploadRateLimiter, validate(updateBookingStatusSchema), bookingController.updateStatus);
