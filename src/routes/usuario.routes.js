import bcrypt from 'bcrypt';
import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();


// 1. POST /empresas - Paso 1: Crear una nueva empresa
router.post('/empresas', async (req, res) => {
  const { nombre_razon_social, rfc, sector, estado_id } = req.body;

  if (!nombre_razon_social || !nombre_razon_social.trim()) {
    return res.status(400).json({
      error: 'El nombre o razón social de la empresa es obligatorio',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Si se envió estado_id, verificamos que exista en la tabla `estados`
    // (o bien lo dejamos NULL si la tabla estados aún está vacía para no violar la FK)
    let validEstadoId = null;
    if (estado_id) {
      const estadoCheck = await client.query(
        'SELECT id FROM estados WHERE id = $1 LIMIT 1',
        [Number(estado_id)]
      );
      if (estadoCheck.rows.length > 0) {
        validEstadoId = Number(estado_id);
      }
    }

    const insertEmpresaQuery = `
      INSERT INTO empresas (nombre_razon_social, rfc, sector, estado_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const result = await client.query(insertEmpresaQuery, [
      nombre_razon_social.trim(),
      rfc ? rfc.trim().toUpperCase() : null,
      sector ? sector.trim() : null,
      validEstadoId,
    ]);

    await client.query('COMMIT');

    res.status(201).json({
      mensaje: 'Empresa registrada exitosamente',
      empresa: result.rows[0], // Devuelve el `id` que se usará como `empresa_id` en el Paso 2
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al crear empresa:', error);
    res.status(500).json({ error: 'Error en el servidor al registrar la empresa' });
  } finally {
    client.release();
  }
});

// 2. GET /empresas - Listar empresas registradas para el selector del Paso 2
router.get('/empresas', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM empresas ORDER BY id DESC;'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener empresas:', error);
    res.status(500).json({ error: 'Error al obtener la lista de empresas' });
  }
});

// 3. POST /usuarios - Paso 2: Crear usuario asociado a la empresa con hash bcrypt
router.post('/usuarios', async (req, res) => {
  const { empresa_id, nombre, correo, password, tipo_rol } = req.body;

  if (!empresa_id || !nombre || !correo || !password) {
    return res.status(400).json({
      error: 'empresa_id, nombre, correo y password son obligatorios',
    });
  }

  try {
    const cleanCorreo = correo.trim().toLowerCase();

    // 1. Verificar que el correo no esté registrado previamente
    const existingUser = await pool.query(
      'SELECT id FROM usuarios WHERE correo = $1 LIMIT 1',
      [cleanCorreo]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Ya existe un usuario registrado con ese correo electrónico',
      });
    }

    // 2. Generar el hash de la contraseña con bcrypt (compatible con tu /api/login)
    const saltRounds = 10;
    const contrasena_hash = await bcrypt.hash(password, saltRounds);

    // 3. Insertar el usuario en la tabla `usuarios`
    const insertUsuarioQuery = `
      INSERT INTO usuarios (empresa_id, nombre, correo, contrasena_hash, tipo_rol)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, empresa_id, nombre, correo, tipo_rol, fecha_creacion;
    `;

    const result = await pool.query(insertUsuarioQuery, [
      Number(empresa_id),
      nombre.trim(),
      cleanCorreo,
      contrasena_hash,
      tipo_rol === 'Admin' ? 'Admin' : 'Empresa',
    ]);

    res.status(201).json({
      mensaje: 'Usuario creado exitosamente',
      usuario: result.rows[0],
    });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ error: 'Error en el servidor al crear el usuario' });
  }
});

// 4. GET /estados - (Opcional) Obtener catálogo de estados de la república
router.get('/estados', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM estados ORDER BY id ASC;');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener estados:', error);
    res.status(500).json({ error: 'Error al obtener estados' });
  }
});



router.put('/empresas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre_razon_social, rfc, sector, estado_id } = req.body;
  if (!nombre_razon_social || !String(nombre_razon_social).trim()) {
    return res.status(400).json({
      message: 'El nombre o razón social de la empresa es obligatorio.',
    });
  }
  try {
    const query = `
      UPDATE empresas
      SET 
        nombre_razon_social = $1,
        rfc = $2,
        sector = $3,
        estado_id = $4
      WHERE id = $5
      RETURNING id, nombre_razon_social, rfc, sector, estado_id, fecha_registro
    `;
    const values = [
      String(nombre_razon_social).trim(),
      rfc ? String(rfc).trim().toUpperCase() : null,
      sector ? String(sector).trim() : null,
      estado_id ? Number(estado_id) : null,
      Number(id),
    ];
    const { rows } = await pool.query(query, values);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Empresa no encontrada.' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error al actualizar empresa:', error);
    res.status(500).json({ message: 'Error interno al actualizar la empresa.' });
  }
});


router.delete('/empresas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount, rows } = await pool.query(
      'DELETE FROM empresas WHERE id = $1 RETURNING id, nombre_razon_social',
      [Number(id)]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Empresa no encontrada.' });
    }
    res.json({
      message: 'Empresa eliminada correctamente.',
      deleted: rows[0],
    });
  } catch (error) {
    console.error('Error al eliminar empresa:', error);
    res.status(500).json({ message: 'Error interno al eliminar la empresa.' });
  }
});

router.get('/usuarios', async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id,
        u.empresa_id,
        e.nombre_razon_social AS empresa_nombre,
        u.nombre,
        u.correo,
        u.tipo_rol,
        u.fecha_creacion
      FROM usuarios u
      LEFT JOIN empresas e ON u.empresa_id = e.id
      ORDER BY u.id ASC
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ message: 'Error al obtener la lista de usuarios.' });
  }
});


router.put('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { empresa_id, nombre, correo, tipo_rol, password, contrasena } = req.body;
  const newPassword = (password || contrasena || '').trim();
  if (!empresa_id || !nombre || !correo || !tipo_rol) {
    return res.status(400).json({
      message: 'Empresa, nombre, correo y rol son obligatorios.',
    });
  }
  try {
    // Validar que el correo no pertenezca a otro usuario distinto
    const duplicateCheck = await pool.query(
      'SELECT id FROM usuarios WHERE LOWER(correo) = LOWER($1) AND id <> $2',
      [String(correo).trim(), Number(id)]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({
        message: 'El correo electrónico ya está en uso por otro usuario.',
      });
    }
    let query;
    let values;
    if (newPassword.length > 0) {
      const contrasenaHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      query = `
        UPDATE usuarios
        SET 
          empresa_id = $1,
          nombre = $2,
          correo = $3,
          tipo_rol = $4,
          contrasena_hash = $5
        WHERE id = $6
        RETURNING id, empresa_id, nombre, correo, tipo_rol, fecha_creacion
      `;
      values = [
        Number(empresa_id),
        String(nombre).trim(),
        String(correo).trim().toLowerCase(),
        String(tipo_rol).trim(),
        contrasenaHash,
        Number(id),
      ];
    } else {
      query = `
        UPDATE usuarios
        SET 
          empresa_id = $1,
          nombre = $2,
          correo = $3,
          tipo_rol = $4
        WHERE id = $5
        RETURNING id, empresa_id, nombre, correo, tipo_rol, fecha_creacion
      `;
      values = [
        Number(empresa_id),
        String(nombre).trim(),
        String(correo).trim().toLowerCase(),
        String(tipo_rol).trim(),
        Number(id),
      ];
    }
    const { rows } = await pool.query(query, values);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        message: 'El correo electrónico ya está en uso por otro usuario.',
      });
    }
    res.status(500).json({ message: 'Error interno al actualizar el usuario.' });
  }
});


router.delete('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount, rows } = await pool.query(
      'DELETE FROM usuarios WHERE id = $1 RETURNING id, nombre, correo',
      [Number(id)]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    res.json({
      message: 'Usuario eliminado correctamente.',
      deleted: rows[0],
    });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).json({ message: 'Error interno al eliminar el usuario.' });
  }
});



export default router;