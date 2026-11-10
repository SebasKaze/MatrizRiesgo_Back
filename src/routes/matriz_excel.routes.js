import { Router } from 'express';
import ExcelJS from 'exceljs';
import { pool } from '../config/db.js';

const router = Router();

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

    // Helper para obtener colores según el Nivel de Riesgo
    const getRiskLevelStyle = (nivelRaw) => {
      if (!nivelRaw || nivelRaw === 'N/A') return null;
      const n = String(nivelRaw).trim().toLowerCase();

      if (n.includes('crítico') || n.includes('critico') || n.includes('extremo') || n.includes('muy alto') || n.includes('intolerable')) {
        return { bg: 'FFFEE2E2', fg: 'FF991B1B' }; // Rojo intenso suave / texto rojo oscuro
      }
      if (n.includes('alto') || n.includes('importante')) {
        return { bg: 'FFFFEDD5', fg: 'FF9A3412' }; // Naranja suave / texto naranja oscuro
      }
      if (n.includes('medio') || n.includes('moderado')) {
        return { bg: 'FFFEF9C3', fg: 'FF854D0E' }; // Amarillo suave / texto ámbar oscuro
      }
      if (n.includes('bajo') || n.includes('mínimo') || n.includes('minimo') || n.includes('tolerable')) {
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

    // Definir anchos y keys de columnas (sin header automático para no sobrescribir la cabecera superior)
    sheet.columns = [
      { key: 'id', width: 12 },
      { key: 'estandar', width: 15 },
      { key: 'subestandar', width: 16 },
      { key: 'title', width: 32 },
      { key: 'description', width: 38 },
      { key: 'causa', width: 30 },
      { key: 'consecuencia', width: 30 },
      { key: 'factor', width: 15 },
      { key: 'probability', width: 14 },
      { key: 'impact', width: 14 },
      { key: 'nivel', width: 18 },
      { key: 'score', width: 12 },
      { key: 'fechaAnalisis', width: 16 },
      { key: 'planAccion', width: 34 },
      { key: 'mitigacion', width: 34 },
      { key: 'nuevaProbabilidad', width: 15 },
      { key: 'nuevoImpacto', width: 15 },
      { key: 'nuevoNivelRiesgo', width: 18 },
      { key: 'fechaTratamiento', width: 18 },
    ];

    // --- SECCIÓN SUPERIOR: TÍTULO Y DATOS DE LA EMPRESA ---
    sheet.mergeCells('A1:S1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'REPORTE EJECUTIVO - MATRIZ DE GESTIÓN Y ANÁLISIS DE RIESGOS';
    titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
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
        { label: 'Empresa / Razón Social:', value: matriz.nombre_razon_social || 'No especificada' },
        { label: 'RFC:', value: matriz.rfc || 'N/A' },
        { label: 'Identificador Matriz:', value: matriz.identificador || `Matriz #${matriz.id}` },
      ],
      [
        { label: 'Sector:', value: matriz.sector || 'N/A' },
        { label: 'Estado:', value: matriz.estado_nombre || 'N/A' },
        { label: 'Versión / Actualización:', value: `v${matriz.version_matriz || 1} (${fechaAct})` },
      ],
    ];

    infoRows.forEach((rowItems, idx) => {
      const rowNum = idx + 2; // Filas 2 y 3
      const row = sheet.getRow(rowNum);
      row.height = 22;

      // Bloque 1: Columnas A-B (label) y C-F (valor)
      sheet.mergeCells(`A${rowNum}:B${rowNum}`);
      sheet.mergeCells(`C${rowNum}:F${rowNum}`);
      // Bloque 2: Columnas G-H (label) y I-L (valor)
      sheet.mergeCells(`G${rowNum}:H${rowNum}`);
      sheet.mergeCells(`I${rowNum}:L${rowNum}`);
      // Bloque 3: Columnas M-N (label) y O-S (valor)
      sheet.mergeCells(`M${rowNum}:N${rowNum}`);
      sheet.mergeCells(`O${rowNum}:S${rowNum}`);

      const blocks = [
        { labelCell: `A${rowNum}`, valCell: `C${rowNum}`, data: rowItems[0] },
        { labelCell: `G${rowNum}`, valCell: `I${rowNum}`, data: rowItems[1] },
        { labelCell: `M${rowNum}`, valCell: `O${rowNum}`, data: rowItems[2] },
      ];

      blocks.forEach(({ labelCell, valCell, data }) => {
        const lCell = sheet.getCell(labelCell);
        lCell.value = data.label;
        lCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1E293B' } };
        lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        lCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

        const vCell = sheet.getCell(valCell);
        vCell.value = data.value;
        vCell.font = { name: 'Calibri', size: 10, bold: false, color: { argb: 'FF0F172A' } };
        vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        vCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      });

      for (let col = 1; col <= 19; col++) {
        row.getCell(col).border = thinBorder;
      }
    });

    // Fila 5: Separador vacío
    sheet.getRow(4).height = 10;

    // --- FILA 6: AGRUPACIÓN DE SECCIONES DE LA TABLA ---
    const groupRow = sheet.getRow(6);
    groupRow.height = 24;

    sheet.mergeCells('A6:H6');
    sheet.getCell('A6').value = '1. IDENTIFICACIÓN Y CONTEXTO DEL RIESGO';
    sheet.getCell('A6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

    sheet.mergeCells('I6:M6');
    sheet.getCell('I6').value = '2. EVALUACIÓN DE RIESGO INHERENTE';
    sheet.getCell('I6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };

    sheet.mergeCells('N6:S6');
    sheet.getCell('N6').value = '3. PLAN DE TRATAMIENTO Y RIESGO RESIDUAL';
    sheet.getCell('N6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };

    ['A6', 'I6', 'N6'].forEach((ref) => {
      const c = sheet.getCell(ref);
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    for (let col = 1; col <= 19; col++) {
      groupRow.getCell(col).border = thinBorder;
    }

    // --- FILA 7: ENCABEZADOS DE COLUMNA ---
    const headers = [
      'ID',
      'Estándar',
      'Subestándar',
      'Riesgo',
      'Descripción',
      'Causa',
      'Consecuencia',
      'Factor',
      'Probabilidad',
      'Impacto',
      'Nivel de Riesgo',
      'Score',
      'Fecha Análisis',
      'Plan de Acción',
      'Mitigación',
      'Nueva Prob.',
      'Nuevo Imp.',
      'Nuevo Nivel',
      'Fecha Tratamiento',
    ];

    const headerRow = sheet.getRow(7);
    headerRow.values = headers;
    headerRow.height = 28;
    headerRow.eachCell((cell, colNumber) => {
      let bgHex = 'FF1E40AF';
      if (colNumber >= 9 && colNumber <= 13) bgHex = 'FF3730A3';
      if (colNumber >= 14) bgHex = 'FF047857';

      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgHex } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = thinBorder;
    });

    // Activar autofiltro en los encabezados de la tabla
    sheet.autoFilter = 'A7:S7';

    // --- FILAS DE DATOS (A PARTIR DE LA FILA 8) ---
    const centerCols = new Set([1, 2, 3, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19]);

    riesgos.forEach((r, idx) => {
      const rowValues = {
        id: r.id || '',
        estandar: r.estandar || 'N/A',
        subestandar: r.subestandar || 'N/A',
        title: r.title || r.riesgo || '',
        description: r.description || r.descripcion || '',
        causa: r.causa || 'N/A',
        consecuencia: r.consecuencia || r.consec || 'N/A',
        factor: r.factor || 'Interno',
        probability: r.probability ?? r.prob ?? '',
        impact: r.impact ?? r.impacto ?? '',
        nivel: r.nivel || '',
        score: r.score ?? '',
        fechaAnalisis: r.fechaAnalisis || 'N/A',
        planAccion: r.planAccion || 'N/A',
        mitigacion: r.mitigacion || 'N/A',
        nuevaProbabilidad: r.nuevaProbabilidad ?? 'N/A',
        nuevoImpacto: r.nuevoImpacto ?? 'N/A',
        nuevoNivelRiesgo: r.nuevoNivelRiesgo || 'N/A',
        fechaTratamiento: r.fechaTratamiento || 'N/A',
      };

      const dataRow = sheet.addRow(rowValues);
      dataRow.height = 30;
      const isEven = idx % 2 === 0;
      const defaultRowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

      dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: defaultRowBg } };
        cell.border = thinBorder;
        cell.alignment = {
          vertical: 'middle',
          horizontal: centerCols.has(colNumber) ? 'center' : 'left',
          wrapText: true,
        };
      });

      // Aplicar semáforo de colores a "Nivel de Riesgo" (col 11) y "Nuevo Nivel" (col 18)
      [
        { col: 11, val: rowValues.nivel },
        { col: 18, val: rowValues.nuevoNivelRiesgo },
      ].forEach(({ col, val }) => {
        const riskStyle = getRiskLevelStyle(val);
        if (riskStyle) {
          const rCell = dataRow.getCell(col);
          rCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: riskStyle.bg } };
          rCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: riskStyle.fg } };
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
    res.status(500).json({ error: 'Error interno al generar el archivo Excel' });
  }
});

export default router;

