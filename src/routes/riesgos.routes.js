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














/**
 * 1. GET /api/estandares
 * Obtiene todos los estándares guardados en la BD para mostrarlos en el pop-up
 */
router.get('/estandares', async (req, res) => {
  try {
    const query = `
      SELECT 
        e.id,
        e.codigo_estandar,
        e.descripcion
      FROM estandar e
      ORDER BY e.codigo_estandar ASC;
    `;
    const { rows } = await pool.query(query);
    return res.status(200).json({ estandares: rows });
  } catch (error) {
    console.error('Error al obtener estándares:', error);
    return res.status(500).json({
      message: 'Error interno al consultar los estándares en la base de datos.',
    });
  }
});

/**
 * 2. POST /api/riesgos/por-estandares
 * Obtiene todos los riesgos asociados a los estándares seleccionados por el usuario
 * Body esperado: { estandar_ids: [1, 2], codigos_estandar: ["ISO 27001", "NOM-035"] }
 */
router.post('/riesgos/por-estandares', async (req, res) => {
  try {
    const { estandar_ids = [], codigos_estandar = [] } = req.body;

    const cleanIds = Array.isArray(estandar_ids)
      ? estandar_ids.map(Number).filter((id) => !isNaN(id) && id > 0)
      : [];

    const cleanCodes = Array.isArray(codigos_estandar)
      ? codigos_estandar.map((c) => String(c).trim()).filter(Boolean)
      : [];

    if (cleanIds.length === 0 && cleanCodes.length === 0) {
      return res.status(200).json({ riesgos: [] });
    }

    const query = `
      SELECT 
        r.id,
        r.subestandar_id,
        s.estandar_id,
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
      WHERE 
        (CARDINALITY($1::int[]) > 0 AND e.id = ANY($1::int[]))
        OR (CARDINALITY($2::text[]) > 0 AND e.codigo_estandar = ANY($2::text[]))
      ORDER BY e.codigo_estandar ASC, s.codigo_subestandar ASC, r.id ASC;
    `;

    const { rows } = await pool.query(query, [cleanIds, cleanCodes]);

    return res.status(200).json({
      riesgos: rows,
    });
  } catch (error) {
    console.error('Error al obtener riesgos por estándares:', error);
    return res.status(500).json({
      message: 'Error al obtener los riesgos asociados a los estándares seleccionados.',
    });
  }
});



















/**
 * 1. PUT /api/riesgos/:id
 * Edita / actualiza un riesgo específico en la tabla `riesgo`
 */
router.put('/riesgos/:id', async (req, res) => {
  try {
    const riesgoId = Number(req.params.id);
    if (isNaN(riesgoId) || riesgoId <= 0) {
      return res.status(400).json({ message: 'ID de riesgo inválido.' });
    }

    const {
      subestandar_id,
      estandar,
      subestandar,
      riesgo,
      descripcion,
      causa,
      consec,
      factor,
      prob,
      impacto,
      nivel,
    } = req.body;

    if (!riesgo || !String(riesgo).trim()) {
      return res.status(400).json({
        message: 'El nombre o título del riesgo es obligatorio.',
      });
    }

    // Resolver subestandar_id si se envió por código de estándar/subestándar
    let resolvedSubestandarId = subestandar_id ? Number(subestandar_id) : null;

    if (!resolvedSubestandarId && subestandar) {
      const subResult = await pool.query(
        `SELECT s.id
         FROM subestandar s
         LEFT JOIN estandar e ON s.estandar_id = e.id
         WHERE s.codigo_subestandar = $1
           AND ($2::text IS NULL OR e.codigo_estandar = $2)
         LIMIT 1;`,
        [String(subestandar).trim(), estandar ? String(estandar).trim() : null]
      );
      if (subResult.rows.length > 0) {
        resolvedSubestandarId = subResult.rows[0].id;
      }
    }

    const updateQuery = `
      UPDATE riesgo
      SET
        subestandar_id = COALESCE($1, subestandar_id),
        riesgo = $2,
        descripcion = $3,
        causa = $4,
        consec = $5,
        factor = $6,
        prob = $7,
        impacto = $8,
        nivel = $9
      WHERE id = $10
      RETURNING *;
    `;

    const values = [
      resolvedSubestandarId,
      String(riesgo).trim(),
      String(descripcion || riesgo).trim(),
      String(causa || '').trim(),
      String(consec || '').trim(),
      String(factor || 'Interno').trim(),
      Number(prob) || 3,
      Number(impacto) || 3,
      String(nivel || 'Medio').trim(),
      riesgoId,
    ];

    const { rows } = await pool.query(updateQuery, values);

    if (rows.length === 0) {
      return res.status(404).json({
        message: `No se encontró el riesgo con ID #${riesgoId}.`,
      });
    }

    // Consultar el registro enriquecido con codigo_estandar y codigo_subestandar
    const enrichedResult = await pool.query(
      `SELECT 
        r.*,
        s.codigo_subestandar,
        e.id AS estandar_id,
        e.codigo_estandar
       FROM riesgo r
       LEFT JOIN subestandar s ON r.subestandar_id = s.id
       LEFT JOIN estandar e ON s.estandar_id = e.id
       WHERE r.id = $1;`,
      [riesgoId]
    );

    return res.status(200).json({
      message: 'Riesgo actualizado correctamente.',
      riesgo: enrichedResult.rows[0] || rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar riesgo:', error);
    return res.status(500).json({
      message: 'Error interno al actualizar el riesgo en la base de datos.',
    });
  }
});

/**
 * 2. DELETE /api/riesgos/:id
 * Elimina un riesgo específico de la tabla `riesgo`
 */
router.delete('/riesgos/:id', async (req, res) => {
  try {
    const riesgoId = Number(req.params.id);
    if (isNaN(riesgoId) || riesgoId <= 0) {
      return res.status(400).json({ message: 'ID de riesgo inválido.' });
    }

    const { rowCount, rows } = await pool.query(
      'DELETE FROM riesgo WHERE id = $1 RETURNING id, riesgo;',
      [riesgoId]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        message: `No se encontró el riesgo con ID #${riesgoId}.`,
      });
    }

    return res.status(200).json({
      message: 'Riesgo eliminado correctamente.',
      eliminado: rows[0],
    });
  } catch (error) {
    console.error('Error al eliminar riesgo:', error);
    return res.status(500).json({
      message: 'Error interno al eliminar el riesgo de la base de datos.',
    });
  }
});




/*
NOTICIAS ROUTES
*/ 

router.get('/noticias', async (_req, res) => {
  try {
    const query = `
      SELECT 
        n.id,
        n.nombre,
        n.area,
        TO_CHAR(n.fecha, 'YYYY-MM-DD') AS fecha,
        n.texto,
        n.estandar_id,
        COALESCE(e.codigo_estandar, n.codigo_estandar, 'General') AS codigo_estandar
      FROM noticias n
      LEFT JOIN estandar e ON n.estandar_id = e.id
      ORDER BY n.fecha DESC, n.id DESC;
    `;
    const { rows } = await pool.query(query);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Error al obtener noticias:', error);
    return res.status(500).json({ error: 'Error al obtener las noticias' });
  }
});
// 2. POST /api/noticias - Crear noticia (Admin)
router.post('/noticias', async (req, res) => {
  const { nombre, area, fecha, texto, estandar_id, codigo_estandar } = req.body;
  if (!nombre || !area || !fecha || !texto || !codigo_estandar) {
    return res.status(400).json({
      error: 'Todos los campos (nombre, area, fecha, texto y codigo_estandar) son obligatorios',
    });
  }
  try {
    const insertQuery = `
      INSERT INTO noticias (nombre, area, fecha, texto, estandar_id, codigo_estandar)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, nombre, area, TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, texto, estandar_id, codigo_estandar;
    `;
    const { rows } = await pool.query(insertQuery, [
      String(nombre).trim(),
      String(area).trim(),
      fecha,
      String(texto).trim(),
      estandar_id ? Number(estandar_id) : null,
      String(codigo_estandar).trim(),
    ]);
    return res.status(201).json({
      mensaje: 'Noticia registrada exitosamente',
      noticia: rows[0],
    });
  } catch (error) {
    console.error('Error al crear noticia:', error);
    return res.status(500).json({ error: 'Error al registrar la noticia' });
  }
});
// 3. PUT /api/noticias/:id - Editar noticia (Admin)
router.put('/noticias/:id', async (req, res) => {
  const noticiaId = Number(req.params.id);
  const { nombre, area, fecha, texto, estandar_id, codigo_estandar } = req.body;
  if (isNaN(noticiaId) || noticiaId <= 0) {
    return res.status(400).json({ error: 'ID de noticia inválido' });
  }
  if (!nombre || !area || !fecha || !texto || !codigo_estandar) {
    return res.status(400).json({
      error: 'Todos los campos son obligatorios para actualizar la noticia',
    });
  }
  try {
    const updateQuery = `
      UPDATE noticias
      SET
        nombre = $1,
        area = $2,
        fecha = $3,
        texto = $4,
        estandar_id = $5,
        codigo_estandar = $6
      WHERE id = $7
      RETURNING id, nombre, area, TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, texto, estandar_id, codigo_estandar;
    `;
    const { rows } = await pool.query(updateQuery, [
      String(nombre).trim(),
      String(area).trim(),
      fecha,
      String(texto).trim(),
      estandar_id ? Number(estandar_id) : null,
      String(codigo_estandar).trim(),
      noticiaId,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Noticia no encontrada' });
    }
    return res.status(200).json({
      mensaje: 'Noticia actualizada exitosamente',
      noticia: rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar noticia:', error);
    return res.status(500).json({ error: 'Error al actualizar la noticia' });
  }
});
// 4. DELETE /api/noticias/:id - Eliminar noticia (Admin)
router.delete('/noticias/:id', async (req, res) => {
  const noticiaId = Number(req.params.id);
  if (isNaN(noticiaId) || noticiaId <= 0) {
    return res.status(400).json({ error: 'ID de noticia inválido' });
  }
  try {
    const { rowCount, rows } = await pool.query(
      'DELETE FROM noticias WHERE id = $1 RETURNING id, nombre;',
      [noticiaId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Noticia no encontrada' });
    }
    return res.status(200).json({
      mensaje: 'Noticia eliminada correctamente',
      eliminada: rows[0],
    });
  } catch (error) {
    console.error('Error al eliminar noticia:', error);
    return res.status(500).json({ error: 'Error al eliminar la noticia' });
  }
});










export default router;