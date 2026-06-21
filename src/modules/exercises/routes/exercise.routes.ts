import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { ExerciseController } from "../controllers/exercise.controller";
import {
  createExerciseSchema,
  exerciseIdSchema,
  listExercisesSchema
} from "../validators/exercise.validator";

const exerciseController = new ExerciseController();
export const exerciseRoutes = Router();

// Pré-montados da plataforma — qualquer um pode ver
exerciseRoutes.get(
  "/prebuilt",
  validate(listExercisesSchema),
  exerciseController.listPrebuilt.bind(exerciseController)
);

// Exercícios do personal logado + prebuilt
exerciseRoutes.get(
  "/",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  validate(listExercisesSchema),
  exerciseController.list.bind(exerciseController)
);

// Apenas exercícios criados pelo próprio personal
exerciseRoutes.get(
  "/mine",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  validate(listExercisesSchema),
  exerciseController.listMine.bind(exerciseController)
);

exerciseRoutes.post(
  "/",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(createExerciseSchema),
  exerciseController.create.bind(exerciseController)
);

exerciseRoutes.delete(
  "/:exerciseId",
  ensureAuthenticated,
  ensureRole(UserRole.PROVIDER),
  uploadRateLimiter,
  validate(exerciseIdSchema),
  exerciseController.delete.bind(exerciseController)
);
