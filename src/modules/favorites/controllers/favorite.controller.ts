import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FavoriteService } from "../services/favorite.service";
const favoriteService = new FavoriteService();
export class FavoriteController {
  async add(request: Request, response: Response) {
    const favorite = await favoriteService.add(request.user!.id, request.body.providerId);
    return response.status(StatusCodes.CREATED).json(favorite);
  }
  async list(request: Request, response: Response) {
    const favorites = await favoriteService.list(request.user!.id);
    return response.json(favorites);
  }
  async remove(request: Request, response: Response) {
    await favoriteService.remove(request.user!.id, request.params.providerId);
    return response.status(StatusCodes.NO_CONTENT).send();
  }
}
