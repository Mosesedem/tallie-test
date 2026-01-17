import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

const libsql = createClient({
  url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
});

const adapter = new PrismaLibSql(libsql);
export const prisma = new PrismaClient({ adapter });
