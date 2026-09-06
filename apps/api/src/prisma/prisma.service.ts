import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma partagé — connexion SQL directe à la base Postgres de Supabase
 * (v18 §5 : NestJS se connecte via Prisma pour garder un vrai contrôle
 * transactionnel, la RLS Postgres restant active en défense en profondeur).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
