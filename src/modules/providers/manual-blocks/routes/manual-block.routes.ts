import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../../middlewares/auth.middleware";
import { ensureRole } from "../../../../middlewares/role.middleware";
import { validate } from "../../../../middlewares/validate.middleware";
import { ManualBlockController } from "../controllers/manual-block.controller";
import { writeRateLimiter } from "../../../../middlewares/rate-limit.middleware";
import { createManualBlockSchema, manualBlockIdSchema } from "../validators/manual-block.validator";

const manualBlockController = new ManualBlockController();

export const manualBlockRoutes = Router();
manualBlockRoutes.use(ensureAuthenticated);
manualBlockRoutes.use(ensureRole(UserRole.PROVIDER));
manualBlockRoutes.get("/", manualBlockController.list);
manualBlockRoutes.post("/", writeRateLimiter, validate(createManualBlockSchema), manualBlockController.create);
manualBlockRoutes.delete("/:blockId", writeRateLimiter, validate(manualBlockIdSchema), manualBlockController.delete);
