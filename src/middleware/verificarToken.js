import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export const verificarToken = (req, res, next) => {
  // El token normalmente se envía en los headers como: "Bearer <token>"
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(403).json({ error: 'Un token es requerido para la autenticación' });
  }

  try {
    // Verificamos si el token es válido usando nuestro secreto
    const decodificado = jwt.verify(token, process.env.JWT_SECRET);
    
    // Inyectamos los datos del usuario en la petición (soportando req.user y req.usuario)
    req.user = decodificado;
    req.usuario = decodificado;
    
    next(); // Permite que la petición continúe a la ruta
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

export default verificarToken;