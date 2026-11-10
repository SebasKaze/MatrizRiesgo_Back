import { Router } from "express";
import { pool } from '../config/db.js';



const router = Router();

// GETs 
router.get('/pruebas/empresas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM empresas');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar la base de datos' });
  }
});
router.get('/pruebas/usuarios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar la base de datos' });
  }
});


// INSERTs
router.post('/insert/pruebas/empresas', async (req, res) => {
  try {
    const result = await pool.query(
      `INSERT INTO empresas (nombre_razon_social, rfc, sector, fecha_registro) 
      VALUES ($1, $2, $3, $4) 
      RETURNING *`,
      ['Empresa de Prueba', 'RFC123456789', 'Sector de Prueba', '2001-01-01']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al insertar en la base de datos' });
  }
});



export default router;

