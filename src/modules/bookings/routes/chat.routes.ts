import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { ChatController } from "../controllers/chat.controller";
import {
  chatBookingIdParamSchema,
  chatSendMessageSchema
} from "../validators/chat.validator";

const chatController = new ChatController();
export const chatRoutes = Router();

chatRoutes.use(ensureAuthenticated);
chatRoutes.use(ensureRole(UserRole.CLIENT, UserRole.PROVIDER, UserRole.ADMIN));
chatRoutes.get("/me/chats", chatController.listMyChats);
chatRoutes.get("/:bookingId/other-user", validate(chatBookingIdParamSchema), chatController.getOtherUser);
chatRoutes.get("/:bookingId/other-user-photo", validate(chatBookingIdParamSchema), chatController.streamOtherUserPhoto);
chatRoutes.get("/:bookingId/messages", validate(chatBookingIdParamSchema), chatController.getMessages);
chatRoutes.post("/:bookingId/messages", validate(chatSendMessageSchema), chatController.sendMessage);
