import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { writeRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { ConsultancyChatController } from "../controllers/consultancy-chat.controller";
import {
  consultancyContractIdParamSchema,
  consultancySendMessageSchema
} from "../validators/consultancy-chat.validator";

const consultancyChatController = new ConsultancyChatController();
export const consultancyChatRoutes = Router();

// Épico de Frentes, Frente 9, Lote 7: chat de consultoria já nasce com
// writeRateLimiter (não uploadRateLimiter) - resolve de saída, pra este
// caminho, o mesmo achado do Lote 9 sobre o chat de agendamento.
consultancyChatRoutes.use(ensureAuthenticated);
consultancyChatRoutes.use(ensureRole(UserRole.CLIENT, UserRole.PROVIDER));
consultancyChatRoutes.get("/my/chats", consultancyChatController.listMyChats);
consultancyChatRoutes.get(
  "/contracts/:contractId/other-user",
  validate(consultancyContractIdParamSchema),
  consultancyChatController.getOtherUser
);
consultancyChatRoutes.get(
  "/contracts/:contractId/messages",
  validate(consultancyContractIdParamSchema),
  consultancyChatController.getMessages
);
consultancyChatRoutes.post(
  "/contracts/:contractId/messages",
  writeRateLimiter,
  validate(consultancySendMessageSchema),
  consultancyChatController.sendMessage
);
