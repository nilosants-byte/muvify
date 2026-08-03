import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { NotificationController } from "../controllers/notification.controller";
import {
  notificationIdParamSchema,
  pushTestSchema,
  registerPushDeviceSchema,
  unregisterPushDeviceSchema
} from "../validators/notification.validator";

const notificationController = new NotificationController();

export const notificationRoutes = Router();

notificationRoutes.use(ensureAuthenticated);
notificationRoutes.get("/inbox", notificationController.listInbox);
notificationRoutes.get("/inbox/unread-count", notificationController.unreadCount);
notificationRoutes.patch("/inbox/read-all", notificationController.markAllAsRead);
notificationRoutes.patch("/inbox/:id/read", validate(notificationIdParamSchema), notificationController.markAsRead);
notificationRoutes.get("/devices", notificationController.listDevices);
notificationRoutes.post(
  "/devices",
  uploadRateLimiter,
  validate(registerPushDeviceSchema),
  notificationController.registerDevice
);
notificationRoutes.delete(
  "/devices",
  uploadRateLimiter,
  validate(unregisterPushDeviceSchema),
  notificationController.unregisterDevice
);
notificationRoutes.post(
  "/test",
  uploadRateLimiter,
  validate(pushTestSchema),
  notificationController.sendTestNotification
);
