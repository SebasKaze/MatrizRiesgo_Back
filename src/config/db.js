import { Pool } from 'pg';

import dotenv from 'dotenv';
dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER  || 'postgres',
  password: process.env.DB_PASSWORD || '2409',
  database: process.env.DB_NAME || 'matriz_riesgos',
  port: process.env.DB_PORT || 5432,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el cliente de la base de datos', err);
  process.exit(-1);
});
