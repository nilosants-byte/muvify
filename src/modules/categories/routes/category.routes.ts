import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { writeRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { CategoryController } from "../controllers/category.controller";
import { categoryIdParamsSchema, createCategorySchema } from "../validators/category.validator";
const categoryController = new CategoryController();
export const categoryRoutes = Router();
categoryRoutes.get("/", categoryController.list);
categoryRoutes.post(
  "/",
  ensureAuthenticated,
  ensureRole(UserRole.ADMIN),
  writeRateLimiter,
  validate(createCategorySchema),
  categoryController.create
);
categoryRoutes.patch(
  "/:categoryId/deactivate",
  ensureAuthenticated,
  ensureRole(UserRole.ADMIN),
  writeRateLimiter,
  validate(categoryIdParamsSchema),
  categoryController.deactivate
);
categoryRoutes.patch(
  "/:categoryId/reactivate",
  ensureAuthenticated,
  ensureRole(UserRole.ADMIN),
  writeRateLimiter,
  validate(categoryIdParamsSchema),
  categoryController.reactivate
);
