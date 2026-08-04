import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { CategoryService } from "../services/category.service";
const categoryService = new CategoryService();
export class CategoryController {
  async create(request: Request, response: Response) {
    const category = await categoryService.create(request.user!.id, request.body.name, request.body.description);
    return response.status(StatusCodes.CREATED).json(category);
  }
  async list(_request: Request, response: Response) {
    const categories = await categoryService.list();
    return response.json(categories);
  }
  async deactivate(request: Request, response: Response) {
    const category = await categoryService.deactivate(request.user!.id, request.params.categoryId);
    return response.json(category);
  }
  async reactivate(request: Request, response: Response) {
    const category = await categoryService.reactivate(request.user!.id, request.params.categoryId);
    return response.json(category);
  }
}
