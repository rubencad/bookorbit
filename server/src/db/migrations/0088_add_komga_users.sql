CREATE TABLE "komga_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"group_unknown_series" boolean DEFAULT true NOT NULL,
	"include_non_comic_books" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "komga_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "komga_users" ADD CONSTRAINT "komga_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "komga_users_username_lower_uidx" ON "komga_users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "komga_users_user_id_idx" ON "komga_users" USING btree ("user_id");