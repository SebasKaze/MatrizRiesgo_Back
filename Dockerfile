# Usar una imagen oficial de Node.js ligera
FROM node:20-alpine

# Establecer el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copiar primero los archivos de definición de paquetes
COPY package*.json ./

# Instalar las dependencias
RUN npm install

# Copiar el resto del código fuente (tu carpeta src)
COPY . .

# Exponer el puerto en el que corre Express
EXPOSE 4000

# Comando por defecto para iniciar la aplicación
CMD ["node", "src/index.js"]