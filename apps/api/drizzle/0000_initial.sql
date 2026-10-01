CREATE TYPE "user_role" AS ENUM ('admin', 'member');
CREATE TYPE "board_role" AS ENUM ('admin', 'member');
CREATE TABLE "users" ("id" uuid PRIMARY KEY, "email" text NOT NULL UNIQUE, "password_hash" text NOT NULL, "role" user_role NOT NULL DEFAULT 'member', "created_at" timestamptz NOT NULL DEFAULT now(), "archived_at" timestamptz);
CREATE TABLE "sessions" ("id" uuid PRIMARY KEY, "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "token_hash" text NOT NULL UNIQUE, "expires_at" timestamptz NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "boards" ("id" uuid PRIMARY KEY, "name" text NOT NULL, "created_by" uuid NOT NULL REFERENCES "users"("id"), "created_at" timestamptz NOT NULL DEFAULT now(), "archived_at" timestamptz);
CREATE TABLE "board_members" ("board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE, "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "role" board_role NOT NULL DEFAULT 'member', "created_at" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("board_id", "user_id"));
CREATE TABLE "columns" ("id" uuid PRIMARY KEY, "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE, "name" text NOT NULL, "position" numeric NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), "archived_at" timestamptz);
CREATE INDEX "board_members_user_idx" ON "board_members" ("user_id", "board_id");
CREATE INDEX "columns_board_position_idx" ON "columns" ("board_id", "position");
