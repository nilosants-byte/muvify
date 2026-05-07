import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { ReviewController } from "../controllers/review.controller";
import { createReviewSchema } from "../validators/review.validator";
const reviewController = new ReviewController();
export const reviewRoutes = Router();
reviewRoutes.use(ensureAuthenticated);
reviewRoutes.post("/", validate(createReviewSchema), reviewController.create);
