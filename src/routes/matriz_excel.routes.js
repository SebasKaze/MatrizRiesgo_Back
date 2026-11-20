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
      ],
      [
        { label: 'Sector:', value: matriz.sector || 'N/A' },
        { label: 'Estado:', value: matriz.estado_nombre || 'N/A' },
        {
          label: 'Versión / Actualización:',
          value: `v${matriz.version_matriz || 1} (${fechaAct})`,
        },
      ],
    ];

    infoRows.forEach((rowItems, idx) => {
      const rowNum = idx + 2; // Filas 2 y 3
      const row = sheet.getRow(rowNum);
      row.height = 22;

      // Bloque 1: Columnas A-B (label) y C-H (valor)
      sheet.mergeCells(`A${rowNum}:B${rowNum}`);
      sheet.mergeCells(`C${rowNum}:H${rowNum}`);
      // Bloque 2: Columnas I-J (label) y K-O (valor)
      sheet.mergeCells(`I${rowNum}:J${rowNum}`);
      sheet.mergeCells(`K${rowNum}:O${rowNum}`);
      // Bloque 3: Columnas P-Q (label) y R-W (valor)
      sheet.mergeCells(`P${rowNum}:Q${rowNum}`);
      sheet.mergeCells(`R${rowNum}:W${rowNum}`);

      const blocks = [
        { labelCell: `A${rowNum}`, valCell: `C${rowNum}`, data: rowItems[0] },
        { labelCell: `I${rowNum}`, valCell: `K${rowNum}`, data: rowItems[1] },
        { labelCell: `P${rowNum}`, valCell: `R${rowNum}`, data: rowItems[2] },
      ];

      blocks.forEach(({ labelCell, valCell, data }) => {
        const lCell = sheet.getCell(labelCell);
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

        const vCell = sheet.getCell(valCell);
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
      });

      for (let col = 1; col <= TOTAL_COLS; col++) {
        row.getCell(col).border = thinBorder;
      }
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
      'ZONA DE RIESGO',
      // Etapa 2 (12 - 16)
      'CONTROLES IMPLEMENTADOS',
      'PROBABILIDAD',
      'IMPACTO',
      'GRADO RIESGO',
      'ZONA DE RIESGO',
      // Etapa 3 (17 - 23)
      'CONTROLES COMPLEMENTARIOS',
      'PROBABILIDAD',
      'IMPACTO',
      'GRADO RIESGO',
      'ZONA DE RIESGO',
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

      // Aplicar semáforo de colores a las 3 columnas de "ZONA DE RIESGO" (Cols 11, 16 y 21)
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
