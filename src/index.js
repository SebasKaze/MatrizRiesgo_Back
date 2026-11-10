import express from "express";
import cors from "cors";
import { pool } from "./config/db.js";

import Pruebas from './routes/pruebas.routes.js';
import Login from './routes/login.routes.js';
import Seed from './routes/seed.routes.js';
import Riesgos from './routes/riesgos.routes.js';
import Matriz from './routes/matriz.routes.js';
import Usuario from './routes/usuario.routes.js';
import Estandar from './routes/estandar.routes.js';
import MatrizExcel from './routes/matriz_excel.routes.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/", (_, res) => {
  res.send("Server: OK");
});
app.get("/api/health", (_, res) => {
  res.send("Health: OK");
});



//app.use('/api', Pruebas);
app.use('/api', Login);
app.use('/api', Riesgos);
app.use('/api', Matriz);
app.use('/api', Usuario);
app.use('/api', Estandar);
app.use('/api', MatrizExcel);


app.use('/seed', Seed);

app.get("/api/db-check", async (_, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS fecha_servidor, current_database() AS base_datos;");
    res.status(200).json({
      estado: "OK",
      mensaje: "Conexión a la base de datos exitosa",
      detalles: result.rows[0],
    });
  } catch (error) {
    console.error("Error al conectar con la base de datos:", error);
    res.status(500).json({
      estado: "ERROR",
      mensaje: "No se pudo conectar a la base de datos",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});