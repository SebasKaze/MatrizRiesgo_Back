import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();


// 1. GET /api/estandares - Obtener todos los estándares registrados
router.get('/estandares', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, codigo_estandar, descripcion FROM estandar ORDER BY id ASC;'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener estándares:', error);
    res.status(500).json({ error: 'Error en el servidor al obtener los estándares' });
  }
});

// 2. POST /api/estandares - Registrar un nuevo estándar
router.post('/estandares', async (req, res) => {
  const { codigo_estandar, descripcion } = req.body;

  if (!codigo_estandar || !descripcion) {
    return res.status(400).json({
      error: 'El código del estándar y su descripción son obligatorios',
    });
  }

  try {
    const cleanCodigo = codigo_estandar.trim();

    // Verificar si ya existe un estándar con ese mismo código
    const existing = await pool.query(
      'SELECT id FROM estandar WHERE LOWER(codigo_estandar) = LOWER($1) LIMIT 1',
      [cleanCodigo]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: `El estándar "${cleanCodigo}" ya se encuentra registrado`,
      });
    }

    const insertQuery = `
      INSERT INTO estandar (codigo_estandar, descripcion)
      VALUES ($1, $2)
      RETURNING id, codigo_estandar, descripcion;
    `;

    const result = await pool.query(insertQuery, [
      cleanCodigo,
      descripcion.trim(),
    ]);

    res.status(201).json({
      mensaje: 'Estándar registrado exitosamente',
      estandar: result.rows[0],
    });
  } catch (error) {
    console.error('Error al crear estándar:', error);
    res.status(500).json({ error: 'Error en el servidor al registrar el estándar' });
  }
});




// 3. GET /api/subestandares - Obtener todos los subestándares junto con el código de su estándar padre
router.get('/subestandares', async (req, res) => {
  const { estandar_id } = req.query;

  try {
    let query = `
      SELECT 
        s.id,
        s.estandar_id,
        e.codigo_estandar,
        s.codigo_subestandar,
        s.descripcion
      FROM subestandar s
      INNER JOIN estandar e ON s.estandar_id = e.id
    `;
    const params = [];

    if (estandar_id) {
      query += ' WHERE s.estandar_id = $1';
      params.push(Number(estandar_id));
    }

    query += ' ORDER BY s.id ASC;';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener subestándares:', error);
    res.status(500).json({ error: 'Error en el servidor al obtener los subestándares' });
  }
});

// 4. POST /api/subestandares - Registrar un nuevo subestándar asociado a un estándar
router.post('/subestandares', async (req, res) => {
  const { estandar_id, codigo_estandar, codigo_subestandar, descripcion } = req.body;

  if ((!estandar_id && !codigo_estandar) || !codigo_subestandar || !descripcion) {
    return res.status(400).json({
      error: 'El estándar asociado, el código del subestándar y la descripción son obligatorios',
    });
  }

  try {
    // Resolver el estandar_id y codigo_estandar en la base de datos
    let finalEstandarId = estandar_id ? Number(estandar_id) : null;
    let finalCodigoEstandar = codigo_estandar ? codigo_estandar.trim() : null;

    let estandarCheck;
    if (finalCodigoEstandar) {
      estandarCheck = await pool.query(
        'SELECT id, codigo_estandar FROM estandar WHERE codigo_estandar = $1 LIMIT 1',
        [finalCodigoEstandar]
      );
    }

    if ((!estandarCheck || estandarCheck.rows.length === 0) && finalEstandarId) {
      estandarCheck = await pool.query(
        'SELECT id, codigo_estandar FROM estandar WHERE id = $1 LIMIT 1',
        [finalEstandarId]
      );
    }

    if (!estandarCheck || estandarCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'El estándar seleccionado no existe en la base de datos',
      });
    }

    finalEstandarId = estandarCheck.rows[0].id;
    finalCodigoEstandar = estandarCheck.rows[0].codigo_estandar;

    const cleanSubCodigo = codigo_subestandar.trim();

    // Verificar que no esté duplicado ese subestándar dentro del mismo estándar
    const existingSub = await pool.query(
      `SELECT id FROM subestandar 
       WHERE estandar_id = $1 AND LOWER(codigo_subestandar) = LOWER($2) 
       LIMIT 1`,
      [finalEstandarId, cleanSubCodigo]
    );

    if (existingSub.rows.length > 0) {
      return res.status(409).json({
        error: `El subestándar "${cleanSubCodigo}" ya está registrado para el estándar "${finalCodigoEstandar}"`,
      });
    }

    const insertQuery = `
      INSERT INTO subestandar (estandar_id, codigo_subestandar, descripcion)
      VALUES ($1, $2, $3)
      RETURNING id, estandar_id, codigo_subestandar, descripcion;
    `;

    const result = await pool.query(insertQuery, [
      finalEstandarId,
      cleanSubCodigo,
      descripcion.trim(),
    ]);

    res.status(201).json({
      mensaje: 'Subestándar registrado exitosamente',
      subestandar: {
        ...result.rows[0],
        codigo_estandar: finalCodigoEstandar,
      },
    });
  } catch (error) {
    console.error('Error al crear subestándar:', error);
    res.status(500).json({ error: 'Error en el servidor al registrar el subestándar' });
  }
});


export default router;