import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { writeRateLimiter } from "../../../middlewares/rate-limit.middleware";
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
// Épico de Frentes, Frente 9, Lote 9: enviar mensagem de chat usava
// uploadRateLimiter (20/hora, mensagem de erro sobre "upload") em vez de
// writeRateLimiter - mesma classe de reaproveitamento incorreto já
// corrigida em outros lugares na Frente 5. O chat de consultoria (Lote 7)
// já nasceu usando writeRateLimiter.
chatRoutes.post("/:bookingId/messages", writeRateLimiter, validate(chatSendMessageSchema), chatController.sendMessage);
