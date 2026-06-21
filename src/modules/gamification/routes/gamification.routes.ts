import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { getAchievements, getMyProfile, setTrainingDays } from "../controllers/gamification.controller";
import { updateTrainingDaysSchema } from "../validators/gamification.validator";

export const gamificationRoutes = Router();

gamificationRoutes.use(ensureAuthenticated);

gamificationRoutes.get("/me", getMyProfile);
gamificationRoutes.get("/achievements", getAchievements);
gamificationRoutes.patch("/training-days", uploadRateLimiter, validate(updateTrainingDaysSchema), setTrainingDays);
