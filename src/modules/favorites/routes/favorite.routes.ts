import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { FavoriteController } from "../controllers/favorite.controller";
import { favoriteParamSchema, favoriteSchema } from "../validators/favorite.validator";
const favoriteController = new FavoriteController();
export const favoriteRoutes = Router();
favoriteRoutes.use(ensureAuthenticated);
// Frente 5 (Descoberta, agendamento e agenda), Lote 11: sem restrição de
// role, qualquer usuário autenticado podia favoritar (inclusive um
// profissional favoritando a própria conta) — favoritos é uma feature do
// cliente, defesa em profundidade além da checagem de negócio já feita
// em FavoriteService.add.
favoriteRoutes.get("/", ensureRole(UserRole.CLIENT), favoriteController.list);
favoriteRoutes.get("/favorited-by-me", ensureRole(UserRole.PROVIDER), favoriteController.countFavoritedByMe);
favoriteRoutes.post("/", ensureRole(UserRole.CLIENT), uploadRateLimiter, validate(favoriteSchema), favoriteController.add);
favoriteRoutes.delete("/:providerId", ensureRole(UserRole.CLIENT), uploadRateLimiter, validate(favoriteParamSchema), favoriteController.remove);
