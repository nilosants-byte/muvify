import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { ExerciseController } from "../controllers/exercise.controller";
import { listExercisesSchema } from "../validators/exercise.validator";

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

// Criação/edição/exclusão de exercício é exclusiva do admin
// (src/modules/admin/routes/admin.routes.ts) — o profissional só consulta
// o catálogo acima e monta treinos com o que já existe.
