import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  followUser,
  getFollowers,
  getFollowing,
  getSuggestions,
  getUserPublicProfile,
  searchUsers,
  unfollowUser,
} from "../services/social.service";

export async function follow(req: Request, res: Response) {
  await followUser(req.user!.id, req.params.userId);
  res.status(StatusCodes.NO_CONTENT).send();
}

export async function unfollow(req: Request, res: Response) {
  await unfollowUser(req.user!.id, req.params.userId);
  res.status(StatusCodes.NO_CONTENT).send();
}

export async function listFollowers(req: Request, res: Response) {
  const { page, limit } = req.query as { page: string; limit: string };
  const result = await getFollowers(req.user!.id, Number(page), Number(limit));
  res.json(result);
}

export async function listFollowing(req: Request, res: Response) {
  const { page, limit } = req.query as { page: string; limit: string };
  const result = await getFollowing(req.user!.id, Number(page), Number(limit));
  res.json(result);
}

export async function search(req: Request, res: Response) {
  const { q, page, limit } = req.query as { q: string; page: string; limit: string };
  const result = await searchUsers(req.user!.id, q, Number(page), Number(limit));
  res.json(result);
}

export async function publicProfile(req: Request, res: Response) {
  const result = await getUserPublicProfile(req.user!.id, req.params.userId);
  res.json(result);
}

export async function suggestions(req: Request, res: Response) {
  const limit = Math.min(Number(req.query.limit ?? 10), 20);
  const result = await getSuggestions(req.user!.id, isNaN(limit) ? 10 : limit);
  res.json(result);
}
