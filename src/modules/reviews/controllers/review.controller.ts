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

  async respond(request: Request, response: Response) {
    const review = await reviewService.respondToReview(
      request.user!.id,
      request.params.reviewId,
      request.body.response
    );
    return response.json(review);
  }
}
