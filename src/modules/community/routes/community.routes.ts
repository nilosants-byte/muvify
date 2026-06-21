import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { commentPost, createPost, deleteCommentCtrl, editCommentCtrl, feed, likePost, listComments, removePost } from "../controllers/feed.controller";
import { follow, listFollowers, listFollowing, publicProfile, search, suggestions, unfollow } from "../controllers/social.controller";
import { ranking } from "../controllers/ranking.controller";
import {
  addCommentSchema,
  commentIdParamSchema,
  createPhotoPostSchema,
  paginationSchema,
  postIdParamSchema,
  rankingQuerySchema,
  searchUsersSchema,
  suggestionsQuerySchema,
  userIdParamSchema,
} from "../validators/community.validator";

export const communityRoutes = Router();

communityRoutes.use(ensureAuthenticated);

// ── Social ────────────────────────────────────────────────────────────────────
communityRoutes.post("/follow/:userId", uploadRateLimiter, validate(userIdParamSchema), follow);
communityRoutes.delete("/follow/:userId", uploadRateLimiter, validate(userIdParamSchema), unfollow);
communityRoutes.get("/followers", validate(paginationSchema), listFollowers);
communityRoutes.get("/following", validate(paginationSchema), listFollowing);
communityRoutes.get("/suggestions", validate(suggestionsQuerySchema), suggestions);
communityRoutes.get("/users/search", validate(searchUsersSchema), search);
communityRoutes.get("/users/:userId", validate(userIdParamSchema), publicProfile);

// ── Feed ──────────────────────────────────────────────────────────────────────
communityRoutes.get("/feed", validate(paginationSchema), feed);
communityRoutes.post("/feed/posts", uploadRateLimiter, validate(createPhotoPostSchema), createPost);
communityRoutes.delete("/feed/posts/:postId", uploadRateLimiter, validate(postIdParamSchema), removePost);
communityRoutes.post("/feed/posts/:postId/like", uploadRateLimiter, validate(postIdParamSchema), likePost);
communityRoutes.get("/feed/posts/:postId/comments", validate(postIdParamSchema), validate(paginationSchema), listComments);
communityRoutes.post("/feed/posts/:postId/comments", uploadRateLimiter, validate(postIdParamSchema), validate(addCommentSchema), commentPost);
communityRoutes.delete("/feed/posts/:postId/comments/:commentId", validate(commentIdParamSchema), deleteCommentCtrl);
communityRoutes.patch("/feed/posts/:postId/comments/:commentId", validate(commentIdParamSchema), validate(addCommentSchema), editCommentCtrl);

// ── Ranking ───────────────────────────────────────────────────────────────────
communityRoutes.get("/ranking", validate(rankingQuerySchema), ranking);
