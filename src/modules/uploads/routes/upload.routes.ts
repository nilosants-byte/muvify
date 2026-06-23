import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { UploadController } from "../controllers/upload.controller";
import { uploadMediaSchema } from "../validators/upload.validator";

const uploadController = new UploadController();
export const uploadRoutes = Router();

uploadRoutes.post(
  "/media",
  ensureAuthenticated,
  uploadRateLimiter,
  validate(uploadMediaSchema),
  uploadController.uploadMedia
);
