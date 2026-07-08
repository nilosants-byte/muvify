import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../shared/errors/app-error";
import { InvalidDataUriError, InvalidFileContentError, uploadMediaFromDataUri } from "../../../shared/services/storage.service";

export class UploadController {
  async uploadMedia(req: Request, res: Response) {
    const { dataUri, folder } = req.body as {
      dataUri: string;
      folder: "profile-photos" | "presentation-videos" | "feed-photos" | "cref-documents" | "attendance-proofs" | "exercise-media";
    };

    try {
      const result = await uploadMediaFromDataUri(dataUri, folder);
      return res.status(StatusCodes.CREATED).json(result);
    } catch (error) {
      if (error instanceof InvalidDataUriError || error instanceof InvalidFileContentError) {
        throw new AppError(error.message, StatusCodes.BAD_REQUEST);
      }
      throw error;
    }
  }
}
