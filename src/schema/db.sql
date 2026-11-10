CREATE TABLE estados (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL -- Estados de la república
);

CREATE TABLE empresas (
    id SERIAL PRIMARY KEY,
    nombre_razon_social VARCHAR(255) NOT NULL,
    rfc VARCHAR(50),
    sector VARCHAR(100),
    estado_id INTEGER,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_empresa_estado FOREIGN KEY (estado_id) REFERENCES estados(id) ON DELETE SET NULL
);

CREATE TABLE estandar (
    id SERIAL PRIMARY KEY,
    codigo_estandar VARCHAR(50) NOT NULL,
    descripcion TEXT NOT NULL
);

CREATE TABLE subestandar (
    id SERIAL PRIMARY KEY,
    estandar_id INTEGER NOT NULL,
    codigo_subestandar VARCHAR(50) NOT NULL,
    descripcion TEXT NOT NULL,
    CONSTRAINT fk_subestandar_estandar FOREIGN KEY (estandar_id) REFERENCES estandar(id) ON DELETE CASCADE
);

CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER, -- Nullable por si el rol 'Admin' no pertenece a una empresa específica
    nombre VARCHAR(255) NOT NULL,
    correo VARCHAR(255) UNIQUE NOT NULL,
    contrasena_hash VARCHAR(255) NOT NULL,
    tipo_rol VARCHAR(50) NOT NULL, -- 'Admin' y 'Empresa'
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuario_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);

CREATE TABLE riesgo (
    id SERIAL PRIMARY KEY,
    subestandar_id INTEGER NOT NULL,
    riesgo VARCHAR(255) NOT NULL,
    descripcion TEXT NOT NULL, 
    causa TEXT NOT NULL,
    consec TEXT NOT NULL,
    factor VARCHAR(20) NOT NULL,
    prob INTEGER NOT NULL,
    impacto INTEGER NOT NULL,
    nivel VARCHAR(50) NOT NULL,
    CONSTRAINT fk_riesgo_subestandar FOREIGN KEY (subestandar_id) REFERENCES subestandar(id) ON DELETE CASCADE
);

CREATE TABLE matriz (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL,
    identificador VARCHAR(255) NOT NULL,
    version_matriz INTEGER NOT NULL DEFAULT 1,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_matriz_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
);

CREATE TABLE matriz_datos (
    id SERIAL PRIMARY KEY,
    matriz_id INTEGER NOT NULL,
    datos JSONB NOT NULL DEFAULT '[]'::jsonb, -- Arreglo JSON con las filas de la matriz y su tratamiento
    CONSTRAINT fk_matriz_datos_matriz FOREIGN KEY (matriz_id) REFERENCES matriz(id) ON DELETE CASCADE
);