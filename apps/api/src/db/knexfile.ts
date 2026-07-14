import type { Knex } from "knex";

function connectionFromEnv(): string | Knex.StaticConnectionConfig {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  return {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "txloom",
    password: process.env.MYSQL_PASSWORD ?? "txloom",
    database: process.env.MYSQL_DATABASE ?? "txloom",
    charset: "utf8mb4",
  };
}

const config: Knex.Config = {
  client: "mysql2",
  connection: connectionFromEnv(),
  migrations: {
    directory: "./migrations",
    extension: "ts",
  },
};

export default config;
