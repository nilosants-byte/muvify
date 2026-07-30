import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ReviewService } from "../services/review.service";
const reviewService = new ReviewService();
export class ReviewController {
  async create(request: Request, response: Response) {
    const review = await reviewService.create(
      request.user!.id,
      request.body.bookingId,
      request.body.rating,
      request.body.comment
    );
    return response.status(StatusCodes.CREATED).json(review);
  }

  async listMine(request: Request, response: Response) {
    const skip = request.query.skip ? Math.max(0, Number(request.query.skip)) : 0;
    const take = request.query.take ? Math.min(50, Math.max(1, Number(request.query.take))) : 20;
    const result = await reviewService.listMine(request.user!.id, skip, take);
    return response.json(result);
  }

  async respond(request: Request, response: Response) {
    const review = await reviewService.respondToReview(
      request.user!.id,
      request.params.reviewId,
      request.body.response
    );
    return response.json(review);
  }
}
