import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL || ''

export default databaseUrl.startsWith('postgres')
  ? defineConfig({
      schema: './src/db/schema-pg.ts',
      out: './drizzle',
      dialect: 'postgresql',
      dbCredentials: { url: databaseUrl },
    })
  : defineConfig({
      schema: './src/db/schema.ts',
      out: './drizzle',
      dialect: 'sqlite',
      dbCredentials: { url: './state/agent-office.db' },
    })
