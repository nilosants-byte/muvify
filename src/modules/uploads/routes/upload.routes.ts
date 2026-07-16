import { NextFunction, Request, Response, Router } from "express";
import { StatusCodes } from "http-status-codes";
import multer, { MulterError } from "multer";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { AppError } from "../../../shared/errors/app-error";
import { UploadController } from "../controllers/upload.controller";
import { uploadMediaSchema } from "../validators/upload.validator";

const uploadController = new UploadController();
export const uploadRoutes = Router();

// Presentation videos are the largest legitimate case (up to 60s, ~40MB decoded) —
// give a bit of headroom above that for the multipart limit.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES }
});

function uploadSingleFile(request: Request, response: Response, next: NextFunction) {
  multerUpload.single("file")(request, response, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(new AppError("Arquivo muito grande.", StatusCodes.BAD_REQUEST));
      }
      return next(new AppError("Falha ao processar o arquivo enviado.", StatusCodes.BAD_REQUEST));
    }
    if (error) {
      return next(error);
    }
    next();
  });
}

uploadRoutes.post(
  "/media",
  ensureAuthenticated,
  uploadRateLimiter,
  uploadSingleFile,
  validate(uploadMediaSchema),
  uploadController.uploadMedia
);
