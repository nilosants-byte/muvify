import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { NotificationController } from "../controllers/notification.controller";
import {
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
notificationRoutes.get("/devices", notificationController.listDevices);
notificationRoutes.post(
  "/devices",
  validate(registerPushDeviceSchema),
  notificationController.registerDevice
);
notificationRoutes.delete(
  "/devices",
  validate(unregisterPushDeviceSchema),
  notificationController.unregisterDevice
);
notificationRoutes.post(
  "/test",
  validate(pushTestSchema),
  notificationController.sendTestNotification
);
