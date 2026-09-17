import { PrismaClient } from "@prisma/client";

// Simple singleton so we don't open a new PrismaClient on every hot-reload / import.
const prisma = new PrismaClient();

export default prisma;
