import { Router } from 'express';
import ExcelJS from 'exceljs';
import { pool } from '../config/db.js';

const router = Router();

/**
 * Calcula el Grado de Riesgo (Probabilidad * Impacto) y la Zona de Riesgo
 * con la misma escala usada en MatrizVisualizacion.jsx:
 * - 1 a 2: Aceptable
 * - 3 a 9: Apreciable
 * - 10 a 16: Importante
 * - 17 a 25: Crítico
 */
function evaluateStageZone(probRaw, impRaw) {
  if (
    probRaw === 'N/A' ||
    impRaw === 'N/A' ||
    probRaw === undefined ||
    impRaw === undefined ||
    probRaw === null ||
    impRaw === null ||
    probRaw === '' ||
    impRaw === ''
  ) {
    return { prob: 'N/A', imp: 'N/A', grado: 'N/A', zona: 'N/A', hasValue: false };
  }

  const numP = Number(probRaw);
  const numI = Number(impRaw);

  if (isNaN(numP) || isNaN(numI) || numP < 1 || numI < 1) {
    return { prob: 'N/A', imp: 'N/A', grado: 'N/A', zona: 'N/A', hasValue: false };
  }

  const grado = numP * numI;
  let zona = 'Aceptable';
  if (grado >= 17) {
    zona = 'Crítico';
  } else if (grado >= 10) {
    zona = 'Importante';
  } else if (grado >= 3) {
    zona = 'Apreciable';
  }

  return { prob: numP, imp: numI, grado, zona, hasValue: true };
}

router.get('/matriz/exportar-excel/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Obtener cabecera de la matriz, datos de la empresa y el JSONB más reciente
    const matrizResult = await pool.query(
      `SELECT 
         m.id,
         m.identificador,
         m.version_matriz,
         m.fecha_creacion,
         m.fecha_actualizacion,
         e.nombre_razon_social,
         e.rfc,
         e.sector,
         est.nombre AS estado_nombre,
         md.datos
       FROM matriz m
       LEFT JOIN empresas e ON m.empresa_id = e.id
       LEFT JOIN estados est ON e.estado_id = est.id
       LEFT JOIN LATERAL (
         SELECT datos
         FROM matriz_datos
         WHERE matriz_id = m.id
         ORDER BY id DESC
         LIMIT 1
       ) md ON true
       WHERE m.id = $1`,
      [id]
    );

    if (matrizResult.rows.length === 0) {
      return res.status(404).json({ error: 'Matriz no encontrada' });
    }

    const matriz = matrizResult.rows[0];
    const riesgos = Array.isArray(matriz.datos) ? matriz.datos : [];

    // Mapa auxiliar de subestándares y estándares en BD por si algún registro solo trae subestandar_id
    const subMapById = new Map();
    const subMapByCode = new Map();
    try {
      const catResult = await pool.query(
        `SELECT s.id AS subestandar_id, s.codigo_subestandar, e.id AS estandar_id, e.codigo_estandar
         FROM subestandar s
         INNER JOIN estandar e ON s.estandar_id = e.id`
      );
      catResult.rows.forEach((row) => {
        subMapById.set(String(row.subestandar_id), row);
        subMapByCode.set(String(row.codigo_subestandar).trim().toLowerCase(), row);
      });
    } catch {
      // Continuar con los datos contenidos en el JSONB
    }

    // Helper para obtener colores según la Zona / Nivel de Riesgo
    const getRiskLevelStyle = (zonaRaw) => {
      if (!zonaRaw || zonaRaw === 'N/A') return null;
      const n = String(zonaRaw).trim().toLowerCase();

      if (
        n.includes('muy grave') ||
        n.includes('crítico') ||
        n.includes('critico') ||
        n.includes('extremo') ||
        n.includes('muy alto') ||
        n.includes('intolerable')
      ) {
        return { bg: 'FFFEE2E2', fg: 'FF991B1B' }; // Rojo suave / texto rojo oscuro
      }
      if (n.includes('importante') || n.includes('alto')) {
        return { bg: 'FFFFEDD5', fg: 'FF9A3412' }; // Naranja suave / texto naranja oscuro
      }
      if (
        n.includes('apreciable') ||
        n.includes('medio') ||
        n.includes('moderado')
      ) {
        return { bg: 'FFFEF9C3', fg: 'FF854D0E' }; // Amarillo suave / texto ámbar oscuro
      }
      if (
        n.includes('marginal') ||
        n.includes('aceptable') ||
        n.includes('bajo') ||
        n.includes('mínimo') ||
        n.includes('minimo') ||
        n.includes('tolerable')
      ) {
        return { bg: 'FFDCFCE7', fg: 'FF166534' }; // Verde suave / texto verde oscuro
      }
      return null;
    };

    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };

    // 2. Crear libro y hoja de Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema de Matriz de Riesgos';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Matriz de Riesgos', {
      views: [{ state: 'frozen', ySplit: 7 }],
    });

    // Definir las 23 columnas (A - W) con Estándar y Subestándar separados
    sheet.columns = [
      // Etapa 1: Identificación y Evaluación del Riesgo (Inherente) (Cols 1-11: A-K)
      { key: 'estandar', width: 15 },
      { key: 'subestandar', width: 16 },
      { key: 'contexto', width: 24 },
      { key: 'proceso', width: 24 },
      { key: 'riesgo', width: 34 },
      { key: 'causas', width: 34 },
      { key: 'consecuencias', width: 34 },
      { key: 'probabilidad1', width: 15 },
      { key: 'impacto1', width: 14 },
      { key: 'gradoRiesgo1', width: 15 },
      { key: 'zonaRiesgo1', width: 18 },
      // Etapa 2: Controles Implementados y Reevaluación (Cols 12-16: L-P)
      { key: 'controlesImplementados', width: 36 },
      { key: 'probabilidad2', width: 15 },
      { key: 'impacto2', width: 14 },
      { key: 'gradoRiesgo2', width: 15 },
      { key: 'zonaRiesgo2', width: 18 },
      // Etapa 3: Controles Complementarios, Riesgo Residual y Seguimiento (Cols 17-23: Q-W)
      { key: 'controlesComplementarios', width: 38 },
      { key: 'probabilidad3', width: 15 },
      { key: 'impacto3', width: 14 },
      { key: 'gradoRiesgo3', width: 15 },
      { key: 'zonaRiesgo3', width: 18 },
      { key: 'seguimientoRevision', width: 42 },
      { key: 'responsable', width: 30 },
    ];

    const TOTAL_COLS = 23; // Columnas A (1) a W (23)

    // --- SECCIÓN SUPERIOR: TÍTULO Y DATOS DE LA EMPRESA ---
    sheet.mergeCells('A1:W1');
    const titleCell = sheet.getCell('A1');
    titleCell.value =
      'REPORTE EJECUTIVO - MATRIZ DE GESTIÓN Y ANÁLISIS DE RIESGOS';
    titleCell.font = {
      name: 'Calibri',
      size: 15,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 34;

    const fechaAct = matriz.fecha_actualizacion
      ? new Date(matriz.fecha_actualizacion).toLocaleDateString('es-MX', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
      : 'N/A';

    const infoRows = [
      [
        {
          label: 'Empresa / Razón Social:',
          value: matriz.nombre_razon_social || 'No especificada',
        },
        { label: 'RFC:', value: matriz.rfc || 'N/A' },
        {
          label: 'Identificador Matriz:',
          value: matriz.identificador || `Matriz #${matriz.id}`,
        },
        { label: 'Domicilio:', value: 'N/A' },
      ],
      [
        { label: 'Sector:', value: matriz.sector || 'N/A' },
        { label: 'Estado:', value: matriz.estado_nombre || 'N/A' },
        {
          label: 'Versión / Actualización:',
          value: `v${matriz.version_matriz || 1} (${fechaAct})`,
        },
        { label: 'Planta:', value: 'N/A' },
      ],
    ];

    // Cada campo utiliza 1 celda para la etiqueta y 1 celda para el valor, sin combinar celdas
    infoRows.forEach((rowItems, idx) => {
      const rowNum = idx + 2; // Filas 2 y 3
      const row = sheet.getRow(rowNum);
      row.height = 22;

      rowItems.forEach((data, itemIdx) => {
        const labelCol = itemIdx * 2 + 1; // Columnas A(1), C(3), E(5), G(7)
        const valCol = labelCol + 1; // Columnas B(2), D(4), F(6), H(8)

        const lCell = row.getCell(labelCol);
        lCell.value = data.label;
        lCell.font = {
          name: 'Calibri',
          size: 10,
          bold: true,
          color: { argb: 'FF1E293B' },
        };
        lCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE2E8F0' },
        };
        lCell.alignment = {
          vertical: 'middle',
          horizontal: 'left',
          indent: 1,
        };
        lCell.border = thinBorder;

        const vCell = row.getCell(valCol);
        vCell.value = data.value;
        vCell.font = {
          name: 'Calibri',
          size: 10,
          bold: false,
          color: { argb: 'FF0F172A' },
        };
        vCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
        vCell.alignment = {
          vertical: 'middle',
          horizontal: 'left',
          indent: 1,
        };
        vCell.border = thinBorder;
      });
    });

    // Fila 4: Separador vacío
    sheet.getRow(4).height = 10;

    // --- FILA 6: AGRUPACIÓN DE LAS 3 ETAPAS DE LA MATRIZ ---
    const groupRow = sheet.getRow(6);
    groupRow.height = 26;

    // Etapa 1: Columnas A a K (1 a 11)
    sheet.mergeCells('A6:K6');
    sheet.getCell('A6').value =
      'ETAPA 1: IDENTIFICACIÓN Y EVALUACIÓN DEL RIESGO (INHERENTE)';
    sheet.getCell('A6').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF3730A3' },
    };

    // Etapa 2: Columnas L a P (12 a 16)
    sheet.mergeCells('L6:P6');
    sheet.getCell('L6').value =
      'ETAPA 2: CONTROLES IMPLEMENTADOS Y REEVALUACIÓN';
    sheet.getCell('L6').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD97706' },
    };

    // Etapa 3: Columnas Q a W (17 a 23)
    sheet.mergeCells('Q6:W6');
    sheet.getCell('Q6').value =
      'ETAPA 3: CONTROLES COMPLEMENTARIOS, RIESGO RESIDUAL Y SEGUIMIENTO';
    sheet.getCell('Q6').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF047857' },
    };

    ['A6', 'L6', 'Q6'].forEach((ref) => {
      const c = sheet.getCell(ref);
      c.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    for (let col = 1; col <= TOTAL_COLS; col++) {
      groupRow.getCell(col).border = thinBorder;
    }

    // --- FILA 7: ENCABEZADOS DE LAS 23 COLUMNAS (ESTÁNDAR Y SUBESTÁNDAR SEPARADOS) ---
    const headers = [
      // Etapa 1 (1 - 11)
      'ESTÁNDAR',
      'SUBESTÁNDAR',
      'CONTEXTO',
      'PROCESO',
      'RIESGO',
      'CAUSAS',
      'CONSECUENCIAS',
      'PROBABILIDAD',
      'IMPACTO',
      'GRADO RIESGO',
      'TIPO DE RIESGO',
      // Etapa 2 (12 - 16)
      'CONTROLES IMPLEMENTADOS',
      'PROBABILIDAD',
      'IMPACTO',
      'GRADO RIESGO',
      'TIPO DE RIESGO',
      // Etapa 3 (17 - 23)
      'CONTROLES COMPLEMENTARIOS',
      'PROBABILIDAD',
      'IMPACTO',
      'GRADO RIESGO',
      'TIPO DE RIESGO',
      'SEGUIMIENTO Y REVISIÓN DE RIESGOS RESIDUALES',
      'RESPONSABLE',
    ];

    const headerRow = sheet.getRow(7);
    headerRow.values = headers;
    headerRow.height = 30;
    headerRow.eachCell((cell, colNumber) => {
      let bgHex = 'FF4338CA'; // Etapa 1 (Indigo)
      if (colNumber >= 12 && colNumber <= 16) bgHex = 'FFB45309'; // Etapa 2 (Amber)
      if (colNumber >= 17) bgHex = 'FF065F46'; // Etapa 3 (Emerald)

      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgHex },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true,
      };
      cell.border = thinBorder;
    });

    // Activar autofiltro en las 23 columnas
    sheet.autoFilter = 'A7:W7';

    // --- FILAS DE DATOS (A PARTIR DE LA FILA 8) ---
    // Columnas centradas: Estándar(1), Subestándar(2), Contexto(3), Prob/Imp/Grado/Zona Etapa1(8,9,10,11), Etapa2(13,14,15,16), Etapa3(18,19,20,21)
    const centerCols = new Set([
      1, 2, 3, 8, 9, 10, 11, 13, 14, 15, 16, 18, 19, 20, 21,
    ]);

    riesgos.forEach((r, idx) => {
      // Evaluación Etapa 1
      const eval1 = evaluateStageZone(
        r.probabilidadEtapa1 ?? r.probability ?? r.prob ?? 3,
        r.impactoEtapa1 ?? r.impact ?? r.impacto ?? 3
      );

      // Evaluación Etapa 2
      const eval2 = evaluateStageZone(
        r.probabilidadEtapa2 ?? r.nuevaProbabilidad ?? 'N/A',
        r.impactoEtapa2 ?? r.nuevoImpacto ?? 'N/A'
      );

      // Evaluación Etapa 3
      const eval3 = evaluateStageZone(
        r.probabilidadEtapa3 ?? 'N/A',
        r.impactoEtapa3 ?? 'N/A'
      );

      // Resolver Estándar y Subestándar desde las propiedades de BD o mapa auxiliar
      const rawSubCode =
        r.codigo_subestandar && r.codigo_subestandar !== 'N/A'
          ? String(r.codigo_subestandar).trim()
          : r.subestandar && r.subestandar !== 'N/A'
          ? String(r.subestandar).trim()
          : '';

      const matchedCatalogSub =
        (r.subestandar_id && subMapById.get(String(r.subestandar_id))) ||
        (rawSubCode && subMapByCode.get(rawSubCode.toLowerCase())) ||
        null;

      const estandarVal =
        (r.codigo_estandar && r.codigo_estandar !== 'N/A'
          ? r.codigo_estandar
          : r.estandar && r.estandar !== 'N/A'
          ? r.estandar
          : matchedCatalogSub?.codigo_estandar) ||
        (r.numeral && String(r.numeral).includes('.')
          ? String(r.numeral).split('.')[0]
          : r.numeral || 'N/A');

      const subestandarVal =
        rawSubCode ||
        matchedCatalogSub?.codigo_subestandar ||
        (r.numeral && r.numeral !== 'N/A' ? r.numeral : 'N/A');

      const contextoVal =
        r.contexto ||
        (r.factor === 'Interno' || r.factor === 'Externo'
          ? r.factor
          : 'Contexto interno / Externo');

      const procesoVal =
        r.proceso || r.category || r.categoria || 'Análisis de riesgo';

      const rowValues = {
        // Etapa 1
        estandar: estandarVal,
        subestandar: subestandarVal,
        contexto: contextoVal,
        proceso: procesoVal,
        riesgo: r.title || r.riesgo || '',
        causas: r.causas || r.causa || 'N/A',
        consecuencias: r.consecuencias || r.consecuencia || r.consec || 'N/A',
        probabilidad1: eval1.prob,
        impacto1: eval1.imp,
        gradoRiesgo1: eval1.grado,
        zonaRiesgo1: eval1.zona,
        // Etapa 2
        controlesImplementados:
          r.controlesImplementados || r.planAccion || 'N/A',
        probabilidad2: eval2.prob,
        impacto2: eval2.imp,
        gradoRiesgo2: eval2.grado,
        zonaRiesgo2: eval2.zona,
        // Etapa 3
        controlesComplementarios:
          r.controlesComplementarios || r.mitigacion || 'N/A',
        probabilidad3: eval3.prob,
        impacto3: eval3.imp,
        gradoRiesgo3: eval3.grado,
        zonaRiesgo3: eval3.zona,
        seguimientoRevision:
          r.seguimientoRevision || r.seguimiento || 'N/A',
        responsable:
          r.responsable ||
          (r.responsible && r.responsible !== 'Asignado'
            ? r.responsible
            : 'N/A'),
      };

      const dataRow = sheet.addRow(rowValues);
      dataRow.height = 34;
      const isEven = idx % 2 === 0;
      const defaultRowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

      dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: defaultRowBg },
        };
        cell.border = thinBorder;
        cell.alignment = {
          vertical: 'middle',
          horizontal: centerCols.has(colNumber) ? 'center' : 'left',
          wrapText: true,
        };
      });

      // Aplicar semáforo de colores a las 3 columnas de "TIPO DE RIESGO" (Cols 11, 16 y 21)
      [
        { col: 11, val: rowValues.zonaRiesgo1 },
        { col: 16, val: rowValues.zonaRiesgo2 },
        { col: 21, val: rowValues.zonaRiesgo3 },
      ].forEach(({ col, val }) => {
        const riskStyle = getRiskLevelStyle(val);
        if (riskStyle) {
          const rCell = dataRow.getCell(col);
          rCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: riskStyle.bg },
          };
          rCell.font = {
            name: 'Calibri',
            size: 10,
            bold: true,
            color: { argb: riskStyle.fg },
          };
        }
      });
    });

    // =========================================================================
    // NUEVA PÁGINA 2: GRADO DE RIESGO (CUADRO ENTRE IMPACTO Y PROBABILIDAD)
    // =========================================================================
    const gradoSheet = workbook.addWorksheet('Grado de Riesgo');
    gradoSheet.columns = [
      { key: 'c1', width: 4 },
      { key: 'c2', width: 26 },
      { key: 'c3', width: 18 },
      { key: 'c4', width: 18 },
      { key: 'c5', width: 18 },
      { key: 'c6', width: 18 },
      { key: 'c7', width: 18 },
    ];

    const boxBorder = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };

    // Título principal de la hoja Grado de Riesgo
    gradoSheet.mergeCells('B2:G2');
    const gradoTitle = gradoSheet.getCell('B2');
    gradoTitle.value =
      'CÁLCULO DEL GRADO DE RIESGO (CUADRO PROBABILIDAD VS. IMPACTO)';
    gradoTitle.font = {
      name: 'Calibri',
      size: 13,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    gradoTitle.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    gradoTitle.alignment = { vertical: 'middle', horizontal: 'center' };
    gradoSheet.getRow(2).height = 30;

    // Breve explicación de cómo se calcula el Grado de Riesgo
    gradoSheet.mergeCells('B4:G4');
    const gradoExpHeader = gradoSheet.getCell('B4');
    gradoExpHeader.value = '¿Cómo se calcula el Grado de Riesgo?';
    gradoExpHeader.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FF1E3A8A' },
    };
    gradoExpHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDBEAFE' },
    };
    gradoExpHeader.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      indent: 1,
    };
    gradoSheet.getRow(4).height = 24;

    gradoSheet.mergeCells('B5:G6');
    const gradoExpBody = gradoSheet.getCell('B5');
    gradoExpBody.value =
      'El Grado de Riesgo se calcula multiplicando el nivel de PROBABILIDAD de que ocurra el evento (escala del 1 al 5) por el nivel de IMPACTO o severidad de sus consecuencias (escala del 1 al 5):\n' +
      'Fórmula:  GRADO DE RIESGO = PROBABILIDAD × IMPACTO  (Resultado entre 1 y 25).';
    gradoExpBody.font = {
      name: 'Calibri',
      size: 10,
      color: { argb: 'FF0F172A' },
    };
    gradoExpBody.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    };
    gradoExpBody.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      wrapText: true,
      indent: 1,
    };
    gradoSheet.getRow(5).height = 22;
    gradoSheet.getRow(6).height = 22;

    for (let r = 4; r <= 6; r++) {
      for (let c = 2; c <= 7; c++) {
        gradoSheet.getRow(r).getCell(c).border = thinBorder;
      }
    }

    // Encabezado superior del cuadro: IMPACTO
    gradoSheet.mergeCells('C8:G8');
    const impactoBanner = gradoSheet.getCell('C8');
    impactoBanner.value = 'IMPACTO (SEVERIDAD DE LAS CONSECUENCIAS)';
    impactoBanner.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    impactoBanner.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF3730A3' },
    };
    impactoBanner.alignment = { vertical: 'middle', horizontal: 'center' };
    gradoSheet.getRow(8).height = 26;

    const esquinaCell = gradoSheet.getCell('B8');
    esquinaCell.value = 'MATRIZ 5 × 5';
    esquinaCell.font = {
      name: 'Calibri',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    esquinaCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };
    esquinaCell.alignment = { vertical: 'middle', horizontal: 'center' };

    for (let c = 2; c <= 7; c++) {
      gradoSheet.getRow(8).getCell(c).border = boxBorder;
    }

    // Fila 9: Niveles de Impacto (Columnas C a G)
    const impactHeaders = [
      'PROBABILIDAD \\ IMPACTO',
      '1 - Insignificante\n(Valor 1)',
      '2 - Menor\n(Valor 2)',
      '3 - Moderado\n(Valor 3)',
      '4 - Mayor\n(Valor 4)',
      '5 - Catastrófico\n(Valor 5)',
    ];

    const row9 = gradoSheet.getRow(9);
    row9.height = 32;
    impactHeaders.forEach((text, i) => {
      const colIdx = i + 2; // Cols B(2) a G(7)
      const cell = row9.getCell(colIdx);
      cell.value = text;
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: i === 0 ? 'FF1E293B' : 'FF4338CA' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true,
      };
      cell.border = boxBorder;
    });

    // Color de cada celda según la ponderación del Grado de Riesgo
    const getScoreCellColor = (score) => {
      if (score >= 15) return { bg: 'FFFF0000', fg: 'FF000000' }; // MUY GRAVE (15 a 25) - Rojo
      if (score >= 9) return { bg: 'FFFF6600', fg: 'FF000000' }; // IMPORTANTE (9 a 14) - Naranja
      if (score >= 3) return { bg: 'FFFFFF00', fg: 'FF000000' }; // APRECIABLE (3 a 8) - Amarillo
      return { bg: 'FF70AD47', fg: 'FF000000' }; // MARGINAL (1 A 2) - Verde
    };

    const probabilityRows = [
      { value: 1, label: '1 - Muy Baja (Valor 1)' },
      { value: 2, label: '2 - Baja (Valor 2)' },
      { value: 3, label: '3 - Media (Valor 3)' },
      { value: 4, label: '4 - Alta (Valor 4)' },
      { value: 5, label: '5 - Muy Alta (Valor 5)' },
    ];

    probabilityRows.forEach((probItem, idx) => {
      const rIdx = 10 + idx; // Filas 10 a 14
      const row = gradoSheet.getRow(rIdx);
      row.height = 28;

      const labelCell = row.getCell(2); // Columna B
      labelCell.value = probItem.label;
      labelCell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      labelCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF334155' },
      };
      labelCell.alignment = { vertical: 'middle', horizontal: 'center' };
      labelCell.border = boxBorder;

      for (let impVal = 1; impVal <= 5; impVal++) {
        const colIdx = impVal + 2; // Columnas C(3) a G(7)
        const score = probItem.value * impVal;
        const style = getScoreCellColor(score);
        const cell = row.getCell(colIdx);

        cell.value = score;
        cell.font = {
          name: 'Calibri',
          size: 11,
          bold: true,
          color: { argb: style.fg },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: style.bg },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = boxBorder;
      }
    });

    // =========================================================================
    // NUEVA PÁGINA 3: CATEGORIZACIÓN DE TIPO DE RIESGO
    // =========================================================================
    const tipoSheet = workbook.addWorksheet('Tipo de Riesgo');
    tipoSheet.columns = [
      { key: 'c1', width: 6 },
      { key: 'c2', width: 32 },
      { key: 'c3', width: 42 },
    ];

    // Título principal de la hoja Tipo de Riesgo
    tipoSheet.mergeCells('B2:C2');
    const tipoTitle = tipoSheet.getCell('B2');
    tipoTitle.value = 'CATEGORIZACIÓN DE TIPO DE RIESGO';
    tipoTitle.font = {
      name: 'Calibri',
      size: 13,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    tipoTitle.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    tipoTitle.alignment = { vertical: 'middle', horizontal: 'center' };
    tipoSheet.getRow(2).height = 30;

    // Breve explicación de cómo se calcula el Tipo de Riesgo
    tipoSheet.mergeCells('B4:C4');
    const tipoExpHeader = tipoSheet.getCell('B4');
    tipoExpHeader.value = '¿Cómo se calcula el Tipo de Riesgo?';
    tipoExpHeader.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FF1E3A8A' },
    };
    tipoExpHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDBEAFE' },
    };
    tipoExpHeader.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      indent: 1,
    };
    tipoSheet.getRow(4).height = 24;

    tipoSheet.mergeCells('B5:C7');
    const tipoExpBody = tipoSheet.getCell('B5');
    tipoExpBody.value =
      'El Tipo de Riesgo se obtiene a partir del puntaje del Grado de Riesgo (Probabilidad × Impacto). ' +
      'Una vez calculado dicho valor (entre 1 y 25), se ubica dentro del rango de PONDERACIÓN correspondiente en la siguiente tabla para clasificarlo como MARGINAL (1 a 2), APRECIABLE (3 a 8), IMPORTANTE (9 a 14) o MUY GRAVE (15 a 25).';
    tipoExpBody.font = {
      name: 'Calibri',
      size: 10,
      color: { argb: 'FF0F172A' },
    };
    tipoExpBody.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    };
    tipoExpBody.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      wrapText: true,
      indent: 1,
    };
    tipoSheet.getRow(5).height = 20;
    tipoSheet.getRow(6).height = 20;
    tipoSheet.getRow(7).height = 20;

    for (let r = 4; r <= 7; r++) {
      for (let c = 2; c <= 3; c++) {
        tipoSheet.getRow(r).getCell(c).border = thinBorder;
      }
    }

    // Encabezado de la tabla: TIPO DE RIESGO | PONDERACIÓN (Fondo negro, letras blancas)
    const tipoTableHeaderRow = tipoSheet.getRow(9);
    tipoTableHeaderRow.height = 34;

    const thTipo = tipoTableHeaderRow.getCell(2);
    thTipo.value = 'TIPO DE RIESGO';
    const thPond = tipoTableHeaderRow.getCell(3);
    thPond.value = 'PONDERACIÓN';

    [thTipo, thPond].forEach((cell) => {
      cell.font = {
        name: 'Calibri',
        size: 13,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = boxBorder;
    });

    // Filas de la tabla de categorización de Tipo de Riesgo
    const categoriasTipoRiesgo = [
      { tipo: 'MARGINAL', ponderacion: '1 A 2', bgColor: 'FF70AD47' },
      { tipo: 'APRECIABLE', ponderacion: '3 a 8', bgColor: 'FFFFFF00' },
      { tipo: 'IMPORTANTE', ponderacion: '9 a 14', bgColor: 'FFFF6600' },
      { tipo: 'MUY GRAVE', ponderacion: '15 a 25', bgColor: 'FFFF0000' },
    ];

    categoriasTipoRiesgo.forEach((cat, idx) => {
      const rIdx = 10 + idx; // Filas 10 a 13
      const row = tipoSheet.getRow(rIdx);
      row.height = 28;

      const cellTipo = row.getCell(2);
      cellTipo.value = cat.tipo;
      cellTipo.font = {
        name: 'Calibri',
        size: 13,
        bold: true,
        color: { argb: 'FF000000' },
      };
      cellTipo.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' },
      };
      cellTipo.alignment = { vertical: 'middle', horizontal: 'center' };
      cellTipo.border = boxBorder;

      const cellPond = row.getCell(3);
      cellPond.value = cat.ponderacion;
      cellPond.font = {
        name: 'Calibri',
        size: 13,
        bold: true,
        color: { argb: 'FF000000' },
      };
      cellPond.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: cat.bgColor },
      };
      cellPond.alignment = { vertical: 'middle', horizontal: 'center' };
      cellPond.border = boxBorder;
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Matriz_${matriz.id}_v${matriz.version_matriz}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error al exportar Excel:', error);
    res
      .status(500)
      .json({ error: 'Error interno al generar el archivo Excel' });
  }
});

export default router;
