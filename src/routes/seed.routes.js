import bcrypt from 'bcrypt';
import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();

router.post('/reg', async (req, res) => {
  try {
    const resEstado = await pool.query(
      `INSERT INTO estados (nombre) VALUES ($1) RETURNING id;`,
      ['Aguascalientes']
    );

    const resEmpresa = await pool.query(
      `INSERT INTO empresas (nombre_razon_social, rfc, sector, estado_id, fecha_registro) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
      ['CMB C.V.', 'LOGI123456789', 'Aduanas', resEstado.rows[0].id, '2001-01-01']
    );
    const empresaId = resEmpresa.rows[0].id;

    const passwordHasheada = await bcrypt.hash('sebas', 10);

    const resUsuario = await pool.query(
      `INSERT INTO usuarios (empresa_id, nombre, correo, contrasena_hash, tipo_rol) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, correo;`,
      [empresaId, 'Sebastian', 'sebas@correo.com', passwordHasheada, 'Admin']
    );

    res.status(201).json({
      mensaje: 'Seed ejecutado exitosamente',
      empresa_id: empresaId,
      usuario: resUsuario.rows[0]
    });
  } catch (error) {
    console.error('❌ Error al insertar datos:', error);
    res.status(500).json({ error: 'Error al insertar datos de prueba' });
  }
});


router.get('/view', async (req, res) => {
  try {
    const estados = await pool.query(`SELECT * FROM estados;`);
    const empresas = await pool.query(`SELECT * FROM empresas;`);
    const usuarios = await pool.query(`SELECT * FROM usuarios;`);

    res.status(200).json({
      estados: estados.rows,
      empresas: empresas.rows,
      usuarios: usuarios.rows
    });
  } catch (error) {
    console.error('❌ Error al obtener datos:', error);
    res.status(500).json({ error: 'Error al obtener datos de prueba' });
  }
});

router.get('/view/estados', async (req, res) => {
  try {
    const estados = await pool.query(`SELECT * FROM estados;`);

    res.status(200).json({
      estados: estados.rows,
    });
  } catch (error) {
    console.error('Error al obtener datos:', error);
    res.status(500).json({ error: 'Error al obtener datos de prueba' });
  }
});

router.get('/view/riesgos', async (req, res) => {
  try {
    const riesgos = await pool.query(`SELECT * FROM riesgo;`);

    res.status(200).json({
      riesgos: riesgos.rows,
    });
  } catch (error) {
    console.error('Error al obtener datos:', error);
    res.status(500).json({ error: 'Error al obtener datos de prueba' });
  }
});

router.get('/view/matriz', async (req, res) => {
  try {
    const matriz = await pool.query(`SELECT * FROM matriz;`);

    res.status(200).json({
      matriz: matriz.rows,
    });
  } catch (error) {
    console.error('Error al obtener datos:', error);
    res.status(500).json({ error: 'Error al obtener datos de prueba' });
  }
});

router.get('/view/matriz_datos', async (req, res) => {
  try {
    const matriz_datos = await pool.query(`SELECT * FROM matriz_datos;`);

    res.status(200).json({
      matriz_datos: matriz_datos.rows,
    });
  } catch (error) {
    console.error('Error al obtener datos:', error);
    res.status(500).json({ error: 'Error al obtener datos de prueba' });
  }
});

router.get('/view/estados', async (req, res) => {
  try {
    const estados = await pool.query(`SELECT * FROM estados;`);

    res.status(200).json({
      estados: estados.rows,
    });
  } catch (error) {
    console.error('Error al obtener datos:', error);
    res.status(500).json({ error: 'Error al obtener datos de prueba' });
  }
});


export default router;