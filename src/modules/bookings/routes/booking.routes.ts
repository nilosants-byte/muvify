import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { BookingController } from "../controllers/booking.controller";
import {
  bookingIdParamSchema,
  completionProofParamSchema,
  contestNoShowSchema,
  createBookingSchema,
  reportNoShowSchema,
  updateBookingStatusSchema,
  verifyAttendanceCodeSchema,
  verifyAttendanceQrSchema
} from "../validators/booking.validator";
const bookingController = new BookingController();
export const bookingRoutes = Router();
bookingRoutes.use(ensureAuthenticated);

const clientOrProvider = ensureRole(UserRole.CLIENT, UserRole.PROVIDER);

bookingRoutes.get("/me", clientOrProvider, bookingController.listMyBookings);
bookingRoutes.post("/", ensureRole(UserRole.CLIENT), uploadRateLimiter, validate(createBookingSchema), bookingController.create);
bookingRoutes.get(
  "/:bookingId/attendance-code",
  clientOrProvider,
  validate(bookingIdParamSchema),
  bookingController.getAttendanceCode
);
bookingRoutes.post(
  "/:bookingId/attendance-code/verify",
  clientOrProvider,
  uploadRateLimiter,
  validate(verifyAttendanceCodeSchema),
  bookingController.verifyAttendanceCode
);
bookingRoutes.post(
  "/:bookingId/attendance-code/verify-qr",
  clientOrProvider,
  uploadRateLimiter,
  validate(verifyAttendanceQrSchema),
  bookingController.verifyAttendanceQr
);
bookingRoutes.patch("/:bookingId/status", clientOrProvider, uploadRateLimiter, validate(updateBookingStatusSchema), bookingController.updateStatus);
bookingRoutes.post(
  "/:bookingId/report-no-show",
  clientOrProvider,
  uploadRateLimiter,
  validate(reportNoShowSchema),
  bookingController.reportNoShow
);
bookingRoutes.post(
  "/:bookingId/contest-no-show",
  clientOrProvider,
  uploadRateLimiter,
  validate(contestNoShowSchema),
  bookingController.contestNoShowReport
);
bookingRoutes.get(
  "/:bookingId/completion-proof/:evidenceUserId",
  clientOrProvider,
  validate(completionProofParamSchema),
  bookingController.getCompletionProofImage
);
