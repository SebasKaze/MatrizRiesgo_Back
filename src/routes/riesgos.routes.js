import bcrypt from 'bcrypt';
import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();


//Registrar un nuevo riesgo con su Estándar y Subestándar
router.post('/riesgos/registrarnuevo', async (req, res) => {
  const {
    estandar,
    subestandar,
    subestandar_id,
    riesgo,
    descripcion,
    causa,
    consec,
    factor,
    prob,
    impacto,
    nivel,
  } = req.body;

  if (!riesgo || !prob || !impacto) {
    return res.status(400).json({
      error: 'Los campos riesgo, probabilidad e impacto son obligatorios',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let finalSubestandarId = subestandar_id || null;
    const codigoEstandar = (estandar || 'N/A').trim();
    const codigoSubestandar = (subestandar || 'N/A').trim();

    // Si no viene un subestandar_id numérico directo, buscamos o creamos el estándar y subestándar por su código
    if (!finalSubestandarId) {
      // 1. Buscar o crear el Estándar
      let estandarResult = await client.query(
        'SELECT id FROM estandar WHERE codigo_estandar = $1 LIMIT 1',
        [codigoEstandar]
      );

      let estandarId;
      if (estandarResult.rows.length > 0) {
        estandarId = estandarResult.rows[0].id;
      } else {
        const nuevoEstandar = await client.query(
          'INSERT INTO estandar (codigo_estandar, descripcion) VALUES ($1, $2) RETURNING id',
          [codigoEstandar, `Estándar ${codigoEstandar}`]
        );
        estandarId = nuevoEstandar.rows[0].id;
      }

      // 2. Buscar o crear el Subestándar asociado a ese Estándar
      let subestandarResult = await client.query(
        'SELECT id FROM subestandar WHERE estandar_id = $1 AND codigo_subestandar = $2 LIMIT 1',
        [estandarId, codigoSubestandar]
      );

      if (subestandarResult.rows.length > 0) {
        finalSubestandarId = subestandarResult.rows[0].id;
      } else {
        const nuevoSubestandar = await client.query(
          'INSERT INTO subestandar (estandar_id, codigo_subestandar, descripcion) VALUES ($1, $2, $3) RETURNING id',
          [estandarId, codigoSubestandar, `Subestándar ${codigoSubestandar}`]
        );
        finalSubestandarId = nuevoSubestandar.rows[0].id;
      }
    }

    // 3. Insertar el riesgo en la tabla `riesgo`
    const insertRiskQuery = `
      INSERT INTO riesgo (
        subestandar_id,
        riesgo,
        descripcion,
        causa,
        consec,
        factor,
        prob,
        impacto,
        nivel
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const riskResult = await client.query(insertRiskQuery, [
      finalSubestandarId,
      riesgo,
      descripcion || riesgo,
      causa || 'Sin causa especificada',
      consec || 'Sin consecuencia especificada',
      factor || 'Interno',
      Number(prob),
      Number(impacto),
      nivel || 'Medio',
    ]);

    await client.query('COMMIT');

    const nuevoRiesgo = riskResult.rows[0];

    res.status(201).json({
      mensaje: 'Riesgo registrado exitosamente',
      riesgo: {
        ...nuevoRiesgo,
        codigo_estandar: codigoEstandar,
        codigo_subestandar: codigoSubestandar,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al registrar riesgo:', error);
    res.status(500).json({ error: 'Error en el servidor al guardar el riesgo' });
  } finally {
    client.release();
  }
});

//Obtener todos los riesgos registrados con su Estándar y Subestándar
router.get('/riesgos/verriesgos', async (req, res) => {
  try {
    const query = `
      SELECT 
        r.id,
        r.subestandar_id,
        e.codigo_estandar,
        s.codigo_subestandar,
        r.riesgo,
        r.descripcion,
        r.causa,
        r.consec,
        r.factor,
        r.prob,
        r.impacto,
        r.nivel
      FROM riesgo r
      INNER JOIN subestandar s ON r.subestandar_id = s.id
      INNER JOIN estandar e ON s.estandar_id = e.id
      ORDER BY r.id DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener riesgos:', error);
    res.status(500).json({ error: 'Error al obtener los riesgos' });
  }
});

export default router;