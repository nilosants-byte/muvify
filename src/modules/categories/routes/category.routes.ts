import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { CategoryController } from "../controllers/category.controller";
import { createCategorySchema } from "../validators/category.validator";
const categoryController = new CategoryController();
export const categoryRoutes = Router();
categoryRoutes.get("/", categoryController.list);
categoryRoutes.post(
  "/",
  ensureAuthenticated,
  ensureRole(UserRole.ADMIN),
  validate(createCategorySchema),
  categoryController.create
);
