
import { Router } from 'express';
import { pool } from '../config/db.js';
import { verificarToken } from '../middleware/verificarToken.js';


const router = Router();


//1: Guardar la información de la matriz en la tabla "matriz"
router.post('/matriz/guardar', async (req, res) => {
  const {
    empresa_id,
    identificador,
    version_matriz = 1,
    matriz_origen_id = null,
  } = req.body;
  if (!empresa_id || !identificador || !String(identificador).trim()) {
    return res.status(400).json({
      message: 'empresa_id e identificador son obligatorios.',
    });
  }
  const parsedVersion = Number(version_matriz) || 1;
  try {
    // Si proviene de una matriz existente (cambio de versión), validar que la nueva versión sea mayor
    if (matriz_origen_id) {
      const originCheck = await pool.query(
        'SELECT version_matriz FROM matriz WHERE id = $1',
        [Number(matriz_origen_id)]
      );
      if (originCheck.rows.length > 0) {
        const originVersion = Number(originCheck.rows[0].version_matriz) || 1;
        if (parsedVersion < originVersion) {
          return res.status(400).json({
            message: `No es posible registrar una versión menor (v${parsedVersion}) que la versión base actual (v${originVersion}).`,
          });
        }
      }
    }
    const insertQuery = `
      INSERT INTO matriz (empresa_id, identificador, version_matriz, fecha_creacion, fecha_actualizacion)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, empresa_id, identificador, version_matriz, fecha_creacion, fecha_actualizacion
    `;
    const { rows } = await pool.query(insertQuery, [
      Number(empresa_id),
      String(identificador).trim(),
      parsedVersion,
    ]);
    res.status(201).json({
      message: 'Matriz registrada exitosamente.',
      matriz: rows[0],
    });
  } catch (error) {
    console.error('Error en POST /api/matriz/guardar:', error);
    res.status(500).json({
      message: 'Error interno al guardar la matriz.',
    });
  }
});
/*
// 2: Actualizar metadatos de una matriz existente
router.put('/matriz/modificar/:id', async (req, res) => {
  const { id } = req.params;
  const { identificador, version_matriz } = req.body;
  try {
    const query = `
      UPDATE matriz
      SET 
        identificador = COALESCE($1, identificador),
        version_matriz = COALESCE($2, version_matriz),
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *;
    `;
    const result = await pool.query(query, [
      identificador ? identificador.trim() : null,
      version_matriz ? Number(version_matriz) : null,
      Number(id),
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Matriz no encontrada' });
    }
    res.json({
      mensaje: 'Matriz actualizada exitosamente',
      matriz: result.rows[0],
    });
  } catch (error) {
    console.error('Error al actualizar matriz:', error);
    res.status(500).json({ error: 'Error en el servidor al actualizar la matriz' });
  }
});
*/

//3: Paso 2: Guardar (o actualizar) el JSONB en la tabla "matriz_datos"
router.post('/matriz_datos', async (req, res) => {
  const { matriz_id, datos } = req.body;

  if (!matriz_id || !Array.isArray(datos)) {
    return res.status(400).json({
      error: 'matriz_id y el arreglo datos son obligatorios',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const jsonPayload = JSON.stringify(datos);

    // Verificar si ya existen datos registrados para esta matriz_id
    const existing = await client.query(
      'SELECT id FROM matriz_datos WHERE matriz_id = $1 LIMIT 1',
      [Number(matriz_id)]
    );

    let result;
    if (existing.rows.length > 0) {
      // Si ya existe, actualizamos el JSONB de esa matriz
      result = await client.query(
        `UPDATE matriz_datos
         SET datos = $1::jsonb
         WHERE matriz_id = $2
         RETURNING *;`,
        [jsonPayload, Number(matriz_id)]
      );
    } else {
      // Si es nueva, insertamos el registro en matriz_datos
      result = await client.query(
        `INSERT INTO matriz_datos (matriz_id, datos)
         VALUES ($1, $2::jsonb)
         RETURNING *;`,
        [Number(matriz_id), jsonPayload]
      );
    }

    // Actualizar la fecha de modificación en la tabla padre "matriz"
    await client.query(
      'UPDATE matriz SET fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = $1',
      [Number(matriz_id)]
    );

    await client.query('COMMIT');

    res.status(201).json({
      mensaje: 'Datos de la matriz guardados exitosamente',
      matriz_datos: result.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al guardar matriz_datos:', error);
    res.status(500).json({
      error: 'Error en el servidor al guardar los datos de la matriz',
    });
  } finally {
    client.release();
  }
});


/*
// 4. GET /matrices?empresa_id=1 - Listar todas las matrices asociadas a la empresa
router.get('/matrices', async (req, res) => {
  const { empresa_id } = req.query;

  try {
    let query = 'SELECT * FROM matriz';
    const params = [];

    if (empresa_id) {
      query += ' WHERE empresa_id = $1';
      params.push(Number(empresa_id));
    }

    query += ' ORDER BY fecha_actualizacion DESC;';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener matrices:', error);
    res.status(500).json({ error: 'Error al obtener las matrices de la empresa' });
  }
});
*/
// 5. GET /matriz_datos/:matriz_id - Cargar el JSONB al editar una matriz en MatrizVisualizacion
router.get('/matriz_datos/:matriz_id', async (req, res) => {
  const { matriz_id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM matriz_datos WHERE matriz_id = $1 LIMIT 1',
      [Number(matriz_id)]
    );

    if (result.rows.length === 0) {
      return res.json({ matriz_id: Number(matriz_id), datos: [] });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener matriz_datos:', error);
    res.status(500).json({ error: 'Error al cargar los datos de la matriz' });
  }
});

/*
// 6. DELETE /matrices/:id - Eliminar una matriz (ON DELETE CASCADE borra su matriz_datos automáticamente)
router.delete('/matrices/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM matriz WHERE id = $1 RETURNING id',
      [Number(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Matriz no encontrada' });
    }

    res.json({ mensaje: 'Matriz eliminada correctamente', id: Number(id) });
  } catch (error) {
    console.error('Error al eliminar matriz:', error);
    res.status(500).json({ error: 'Error al eliminar la matriz' });
  }
});
*/






/**
 * 1. LISTAR MATRICES
 * GET /api/matrices
 * - Admin: visualiza todas las matrices de todas las empresas (con el nombre de cada empresa)
 * - Empresa: visualiza únicamente las matrices asociadas a su empresa_id
 */
router.get('/matrices', verificarToken, async (req, res) => {
  try {
    //console.log('1. Query Params (URL):', req.query);
    //console.log('2. Datos del Usuario (Token/Sesión):', req.user);
    const rolUsuario = String(req.user?.rol || '').toLowerCase();
    const isAdmin = rolUsuario === 'admin' || rolUsuario === 'administrador';
    const empresaIdParam = req.query.empresa_id || req.user?.empresa_id;

    // Si es Admin y no filtró por una empresa específica, devuelve todas las matrices de todas las empresas
    if (isAdmin && !req.query.empresa_id) {
      const result = await pool.query(
        `SELECT 
           m.id,
           m.empresa_id,
           e.nombre_razon_social AS nombre_empresa,
           m.identificador,
           m.version_matriz,
           m.fecha_creacion,
           m.fecha_actualizacion
         FROM matriz m
         LEFT JOIN empresas e ON e.id = m.empresa_id
         ORDER BY m.fecha_actualizacion DESC, m.id DESC`
      );
      return res.json(result.rows);
    }

    // Usuario tipo "empresa" (forzado a su empresa_id) o Admin filtrando por empresa_id
    const targetEmpresaId = isAdmin ? empresaIdParam : (req.user?.empresa_id || empresaIdParam);

    if (!targetEmpresaId) {
      return res.status(400).json({ error: 'Se requiere empresa_id para consultar las matrices.' });
    }

    const result = await pool.query(
      `SELECT 
         m.id,
         m.empresa_id,
         e.nombre_razon_social AS nombre_empresa,
         m.identificador,
         m.version_matriz,
         m.fecha_creacion,
         m.fecha_actualizacion
       FROM matriz m
       LEFT JOIN empresas e ON e.id = m.empresa_id
       WHERE m.empresa_id = $1
       ORDER BY m.fecha_actualizacion DESC, m.id DESC`,
      [targetEmpresaId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener matrices:', error);
    return res.status(500).json({ error: 'Error interno al obtener el listado de matrices.' });
  }
});

/**
 * 2. MODIFICAR CABECERA DE MATRIZ
 * PUT /api/matriz/modificar/:id
 * - Admin: puede editar matrices de cualquier empresa
 * - Empresa: solo puede editar matrices que pertenezcan a su empresa_id
 * - Regla 1: No permite bajar la versión respecto a la versión actual
 * - Regla 2: Si incrementa la versión, crea un nuevo registro conservando la versión anterior
 */
router.put('/matriz/modificar/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { empresa_id, identificador, version_matriz } = req.body;

  if (!identificador || !String(identificador).trim()) {
    return res.status(400).json({
      error: 'El identificador de la matriz es obligatorio.',
      message: 'El identificador de la matriz es obligatorio.',
    });
  }

  try {
    const rolUsuario = String(req.user?.rol || '').toLowerCase();
    const isAdmin = rolUsuario === 'admin' || rolUsuario === 'administrador';

    // 1. Verificar existencia de la matriz
    const existingResult = await pool.query(
      'SELECT id, empresa_id, identificador, version_matriz FROM matriz WHERE id = $1',
      [Number(id)]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Matriz no encontrada.',
        message: 'Matriz no encontrada.',
      });
    }

    const currentMatriz = existingResult.rows[0];

    // 2. Validar permisos de propiedad (si no es Admin, solo puede modificar los de su empresa)
    if (
      !isAdmin &&
      req.user?.empresa_id &&
      Number(currentMatriz.empresa_id) !== Number(req.user.empresa_id)
    ) {
      return res.status(403).json({
        error: 'No tienes permiso para modificar una matriz de otra empresa.',
        message: 'No tienes permiso para modificar una matriz de otra empresa.',
      });
    }

    // Solo Admin puede reasignar empresa_id; usuario Empresa mantiene la empresa actual
    const finalEmpresaId = isAdmin
      ? Number(empresa_id || currentMatriz.empresa_id)
      : Number(currentMatriz.empresa_id);

    const currentVersion = Number(currentMatriz.version_matriz) || 1;
    const requestedVersion =
      version_matriz !== undefined ? Number(version_matriz) : currentVersion;

    // 3. Regla 1: No permitir bajar el número de la versión
    if (requestedVersion < currentVersion) {
      const msg = `No es posible cambiar la versión de v${currentVersion} a una versión menor (v${requestedVersion}). Selecciona esa versión en la vista de Matrices.`;
      return res.status(400).json({
        error: msg,
        message: msg,
      });
    }

    // 4. Regla 2: Si el usuario incrementó la versión al actualizar, crear un nuevo registro para conservar la anterior
    if (requestedVersion > currentVersion) {
      const insertNewVersionQuery = `
        INSERT INTO matriz (empresa_id, identificador, version_matriz, fecha_creacion, fecha_actualizacion)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id, empresa_id, identificador, version_matriz, fecha_creacion, fecha_actualizacion
      `;
      const { rows: createdRows } = await pool.query(insertNewVersionQuery, [
        finalEmpresaId,
        String(identificador).trim(),
        requestedVersion,
      ]);
      const msg = `Se creó la versión ${requestedVersion} como nuevo registro conservando la versión ${currentVersion}.`;
      return res.status(201).json({
        mensaje: msg,
        message: msg,
        matriz: createdRows[0],
        nueva_version_creada: true,
      });
    }

    // 5. Misma versión: actualizar el registro actual
    const updateQuery = `
      UPDATE matriz
      SET 
        empresa_id = $1,
        identificador = $2,
        version_matriz = $3,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING id, empresa_id, identificador, version_matriz, fecha_creacion, fecha_actualizacion
    `;
    const { rows: updatedRows } = await pool.query(updateQuery, [
      finalEmpresaId,
      String(identificador).trim(),
      currentVersion,
      Number(id),
    ]);

    return res.json({
      mensaje: 'Matriz actualizada correctamente.',
      message: 'Matriz actualizada correctamente.',
      matriz: updatedRows[0],
      nueva_version_creada: false,
    });
  } catch (error) {
    console.error('Error en PUT /api/matriz/modificar/:id:', error);
    return res.status(500).json({
      error: 'Error interno al actualizar la matriz.',
      message: 'Error interno al actualizar la matriz.',
    });
  }
});




/**
 * 3. ELIMINAR MATRIZ (Y SUS DATOS ASOCIADOS)
 * DELETE /api/matrices/:id
 * - Admin: puede eliminar matrices de cualquier empresa
 * - Empresa: únicamente puede eliminar matrices de su propia empresa
 */
router.delete('/matrices/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {

    
    const rolUsuario = String(req.user?.rol || '').toLowerCase();
    const isAdmin = rolUsuario === 'admin' || rolUsuario === 'administrador';

    const check = await client.query('SELECT id, empresa_id FROM matriz WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'La matriz no existe.' });
    }

    const matrizActual = check.rows[0];
    if (!isAdmin && req.user?.empresa_id && Number(matrizActual.empresa_id) !== Number(req.user.empresa_id)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar matrices de otra empresa.' });
    }

    await client.query('BEGIN');

    // Eliminar primero los registros hijos en `matriz_datos`
    await client.query('DELETE FROM matriz_datos WHERE matriz_id = $1', [id]);

    // Eliminar la cabecera en `matriz`
    await client.query('DELETE FROM matriz WHERE id = $1', [id]);

    await client.query('COMMIT');

    return res.json({
      mensaje: `Matriz #${id} eliminada exitosamente.`,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al eliminar matriz:', error);
    return res.status(500).json({ error: 'Error interno al eliminar la matriz.' });
  } finally {
    client.release();
  }
});












export default router;