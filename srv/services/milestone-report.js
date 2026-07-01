// ─────────────────────────────────────────────────────────────────────────────
// FILE: srv/services/milestone-report.js
// Milestone reporting (Phase 15). Pure data-in → file-buffer-out; no CDS here.
// Generates real .xlsx (exceljs) and .pdf (pdfkit) documents for the six
// milestone reports. Consumed by the ProjectService.generateMilestoneReport action.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// Column definitions per report type. `money: true` → currency formatting.
const REPORTS = {
    status: {
        title: 'Milestone Status Report',
        columns: [
            { header: '#', key: 'sequence', width: 6 },
            { header: 'Milestone', key: 'name', width: 32 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Progress %', key: 'progressPct', width: 12 },
            { header: 'Owner', key: 'ownerName', width: 20 },
            { header: 'Planned Start', key: 'plannedStartDate', width: 14 },
            { header: 'Planned End', key: 'plannedEndDate', width: 14 },
            { header: 'Approval', key: 'approvalStatus', width: 16 }
        ]
    },
    budget: {
        title: 'Milestone Budget Report',
        columns: [
            { header: 'Milestone', key: 'name', width: 32 },
            { header: 'Planned Budget', key: 'plannedBudget', width: 16, money: true },
            { header: 'Allocated Cost', key: 'allocatedCost', width: 16, money: true },
            { header: 'Actual Cost', key: 'actualCost', width: 16, money: true },
            { header: 'Forecast Cost', key: 'forecastCost', width: 16, money: true },
            { header: 'Remaining', key: 'remainingBudget', width: 16, money: true },
            { header: 'Variance', key: 'budgetVariance', width: 16, money: true }
        ]
    },
    resource: {
        title: 'Milestone Resource Report',
        columns: [
            { header: 'Milestone', key: 'name', width: 32 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Resources', key: 'resourceCount', width: 12 },
            { header: 'Tasks', key: 'taskCount', width: 10 },
            { header: 'Allocated Cost', key: 'allocatedCost', width: 16, money: true }
        ]
    },
    delay: {
        title: 'Milestone Delay Analysis Report',
        columns: [
            { header: 'Milestone', key: 'name', width: 32 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Planned End', key: 'plannedEndDate', width: 14 },
            { header: 'Actual End', key: 'actualEndDate', width: 14 },
            { header: 'Delay (days)', key: 'delayDays', width: 12 },
            { header: 'Early (days)', key: 'earlyDays', width: 12 }
        ]
    },
    forecast: {
        title: 'Milestone Forecast Report',
        columns: [
            { header: 'Milestone', key: 'name', width: 32 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Progress %', key: 'progressPct', width: 12 },
            { header: 'Planned Budget', key: 'plannedBudget', width: 16, money: true },
            { header: 'Forecast Cost', key: 'forecastCost', width: 16, money: true },
            { header: 'Variance', key: 'budgetVariance', width: 16, money: true }
        ]
    },
    health: {
        title: 'Project Health Report',
        columns: [
            { header: '#', key: 'sequence', width: 6 },
            { header: 'Milestone', key: 'name', width: 30 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Progress %', key: 'progressPct', width: 12 },
            { header: 'Delay (days)', key: 'delayDays', width: 12 },
            { header: 'Planned Budget', key: 'plannedBudget', width: 16, money: true },
            { header: 'Forecast Cost', key: 'forecastCost', width: 16, money: true }
        ]
    }
};

function safe(v) { return (v === null || v === undefined) ? '' : v; }

async function toExcel(def, project, rollup) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ccentrik';
    const ws = wb.addWorksheet(def.title.slice(0, 28));
    // Title + project context rows.
    ws.mergeCells(1, 1, 1, def.columns.length);
    ws.getCell(1, 1).value = def.title;
    ws.getCell(1, 1).font = { size: 14, bold: true };
    ws.getCell(2, 1).value = `Project: ${project.projectName} (${project.projectId})`;
    ws.getCell(3, 1).value = `Execution Budget: ${inr(rollup.executionBudget)}  ·  Generated: ${new Date().toISOString().slice(0, 10)}`;
    // Header row.
    const headerRow = 5;
    def.columns.forEach((c, i) => {
        const cell = ws.getCell(headerRow, i + 1);
        cell.value = c.header; cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2FF' } };
        ws.getColumn(i + 1).width = c.width;
    });
    (rollup.milestones || []).forEach((m, r) => {
        def.columns.forEach((c, i) => {
            const cell = ws.getCell(headerRow + 1 + r, i + 1);
            cell.value = safe(m[c.key]);
            if (c.money) cell.numFmt = '#,##0';
        });
    });
    return wb.xlsx.writeBuffer();
}

function toPdf(def, project, rollup) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
        const chunks = [];
        doc.on('data', d => chunks.push(d));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(16).text(def.title, { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor('#555')
            .text(`Project: ${project.projectName} (${project.projectId})`)
            .text(`Execution Budget: ${inr(rollup.executionBudget)}   |   Generated: ${new Date().toISOString().slice(0, 10)}`);
        doc.moveDown(0.6).fillColor('#000');

        const cols = def.columns;
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const totalW = cols.reduce((s, c) => s + c.width, 0);
        const x0 = doc.page.margins.left;
        const colX = []; let acc = x0;
        cols.forEach(c => { colX.push(acc); acc += (c.width / totalW) * pageWidth; });
        const cellW = i => ((cols[i].width / totalW) * pageWidth) - 4;

        const drawRow = (vals, opts) => {
            opts = opts || {};
            const y = doc.y;
            doc.fontSize(8).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica');
            let maxH = 0;
            vals.forEach((v, i) => { maxH = Math.max(maxH, doc.heightOfString(String(v), { width: cellW(i) })); });
            if (y + maxH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); }
            const yy = doc.y;
            vals.forEach((v, i) => { doc.text(String(v), colX[i] + 2, yy + 2, { width: cellW(i) }); });
            doc.y = yy + maxH + 6;
            doc.moveTo(x0, doc.y - 3).lineTo(x0 + pageWidth, doc.y - 3).strokeColor('#e2e8f0').stroke();
        };

        drawRow(cols.map(c => c.header), { bold: true });
        (rollup.milestones || []).forEach(m => {
            drawRow(cols.map(c => c.money ? inr(m[c.key]) : safe(m[c.key])));
        });
        doc.end();
    });
}

// Build a report file. Returns { buffer, fileName, mime }.
async function buildMilestoneReport({ project, rollup, reportType, format }) {
    const def = REPORTS[reportType];
    if (!def) throw new Error(`Unknown report type "${reportType}".`);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${project.projectId}_${reportType}_${stamp}`;
    if (format === 'pdf') {
        return { buffer: await toPdf(def, project, rollup), fileName: base + '.pdf', mime: 'application/pdf' };
    }
    return {
        buffer: await toExcel(def, project, rollup),
        fileName: base + '.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
}

module.exports = { buildMilestoneReport, REPORT_TYPES: Object.keys(REPORTS) };
