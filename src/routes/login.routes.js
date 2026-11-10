import bcrypt from 'bcrypt'
import jwt from "jsonwebtoken";
import dotenv from 'dotenv';
import { Router } from "express";
import { pool } from '../config/db.js';

const router = Router();
dotenv.config();


router.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const usuario = userResult.rows[0];

    const validPassword = await bcrypt.compare(password, usuario.contrasena_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { 
        id: usuario.id, 
        empresa_id: usuario.empresa_id, 
        rol: usuario.tipo_rol 
      }, 
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      mensaje: 'Autenticación exitosa',
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        empresa_id: usuario.empresa_id
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

router.post('/api/registrar_usuario', async (req, res) => {
  const { empresa_id, nombre, correo, password, tipo_rol } = req.body;

  try {
    const usuarioExistente = await pool.query('SELECT id FROM usuarios WHERE correo = $1', [correo]);
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    // 2. Hashear la contraseña recibida
    const saltRounds = 10;
    const passwordHasheada = await bcrypt.hash(password, saltRounds);

    // 3. Insertar en la base de datos
    const nuevoUsuario = await pool.query(
      `INSERT INTO usuarios (empresa_id, nombre, correo, contrasena_hash, tipo_rol) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, nombre, correo, tipo_rol`,
      [empresa_id, nombre, correo, passwordHasheada, tipo_rol]
    );

    res.status(201).json({
      mensaje: 'Usuario creado exitosamente',
      usuario: nuevoUsuario.rows[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el usuario' });
  }
});




export default router;
