import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-key',
  databasePath: process.env.DATABASE_PATH || './data/remotecli.db',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
};