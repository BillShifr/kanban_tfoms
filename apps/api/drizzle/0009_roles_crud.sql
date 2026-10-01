ALTER TYPE "user_role" RENAME VALUE 'member' TO 'user';

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user';
