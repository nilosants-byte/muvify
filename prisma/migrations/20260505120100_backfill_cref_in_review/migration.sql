UPDATE "ProviderProfile"
SET "crefValidationStatus" = 'IN_REVIEW'
WHERE "crefValidationStatus" = 'PENDING'
  AND "crefNumber" IS NOT NULL
  AND btrim("crefNumber") <> ''
  AND "credentialDocuments" IS NOT NULL
  AND jsonb_typeof("credentialDocuments"::jsonb) = 'array'
  AND jsonb_array_length("credentialDocuments"::jsonb) >= 2;
