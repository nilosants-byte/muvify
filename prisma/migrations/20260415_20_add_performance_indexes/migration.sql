-- Performance: composite index covering the production search filter
-- (crefValidatedAt IS NOT NULL) sorted by averageRating DESC, totalReviews DESC.
CREATE INDEX IF NOT EXISTS "ProviderProfile_crefValidatedAt_averageRating_totalReviews_idx"
  ON "ProviderProfile" ("crefValidatedAt", "averageRating" DESC, "totalReviews" DESC);
