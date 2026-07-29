import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  addComment,
  createManualPhotoPost,
  deleteComment,
  deletePost,
  editComment,
  getComments,
  getFeed,
  toggleLike,
} from "../services/feed.service";

export async function feed(req: Request, res: Response) {
  const { page, limit } = req.query as { page: string; limit: string };
  const result = await getFeed(req.user!.id, Number(page), Number(limit));
  res.json(result);
}

export async function createPost(req: Request, res: Response) {
  const { imageUrl, caption } = req.body as { imageUrl?: string; caption?: string };
  await createManualPhotoPost(req.user!.id, imageUrl, caption);
  res.status(StatusCodes.CREATED).send();
}

export async function likePost(req: Request, res: Response) {
  const result = await toggleLike(req.params.postId, req.user!.id);
  res.json(result);
}

export async function commentPost(req: Request, res: Response) {
  const { content } = req.body as { content: string };
  const comment = await addComment(req.params.postId, req.user!.id, content);
  res.status(StatusCodes.CREATED).json(comment);
}

export async function listComments(req: Request, res: Response) {
  const { page, limit } = req.query as { page: string; limit: string };
  const result = await getComments(req.params.postId, req.user!.id, Number(page), Number(limit));
  res.json(result);
}

export async function deleteCommentCtrl(req: Request, res: Response) {
  await deleteComment(req.params.commentId, req.user!.id);
  res.status(StatusCodes.NO_CONTENT).send();
}

export async function editCommentCtrl(req: Request, res: Response) {
  const { content } = req.body as { content: string };
  const updated = await editComment(req.params.commentId, req.user!.id, content);
  res.json(updated);
}

export async function removePost(req: Request, res: Response) {
  await deletePost(req.params.postId, req.user!.id);
  res.status(StatusCodes.NO_CONTENT).send();
}
