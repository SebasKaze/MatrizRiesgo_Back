# Usar una imagen oficial de Node.js ligera
FROM node:22-alpine

# Establecer el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copiar primero los archivos de definición de paquetes para aprovechar la caché
COPY package.json package-lock.json* ./

# Instalar únicamente las dependencias de producción de forma limpia
RUN npm ci --omit=dev

# Copiar el resto del código fuente
COPY . .

# Variable de entorno por defecto para el puerto
ENV PORT=4000

# Exponer el puerto en el que corre Express
EXPOSE 4000

# Comando por defecto para iniciar la aplicación
CMD ["node", "src/index.js"]
