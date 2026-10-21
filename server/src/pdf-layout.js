const PDFDocument = require("pdfkit");
const crypto = require("node:crypto");

const PAGE_MARGIN = 46;
const PAGE_BOTTOM = 790;
const WIDTH = 503;
const PALETTE = {
  navy: "#17142c",
  purple: "#28234a",
  lavender: "#a99cff",
  ink: "#211e34",
  muted: "#716d83",
  border: "#e6e3ef",
  surface: "#f7f6fb",
  white: "#ffffff",
  green: "#14804a",
  greenBg: "#e9f7ef",
  red: "#b42332",
  redBg: "#fff0f0",
  amber: "#9a5d00",
  amberBg: "#fff6e5",
};

function dateText(value) {
  const isoDate = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year.slice(-2)}` : "";
}

function formatMoney(value) {
  return `INR ${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function textHeight(pdf, value, width, fontSize, font = "Helvetica") {
  pdf.font(font).fontSize(fontSize);
  return pdf.heightOfString(String(value ?? ""), { width, lineGap: 1.5 });
}

function roundRect(pdf, x, y, width, height, radius, color) {
  pdf.roundedRect(x, y, width, height, radius).fill(color);
}

function drawPageHeader(pdf, report) {
  const x = PAGE_MARGIN;
  const top = 32;
  const boxHeight = 72;
  roundRect(pdf, x, top, WIDTH, boxHeight, 10, PALETTE.navy);
  pdf.fillColor(PALETTE.lavender).font("Helvetica-Bold").fontSize(19)
    .text("RTIGO", x + 18, top + 13, { lineBreak: false });
  pdf.fillColor("#d0c9ee").font("Helvetica").fontSize(8)
    .text("Track Today. Grow Tomorrow.", x + 19, top + 39, { lineBreak: false });
  const badge = report.documentLabel.toUpperCase();
  pdf.font("Helvetica-Bold").fontSize(8);
  const badgeWidth = Math.min(175, pdf.widthOfString(badge) + 26);
  roundRect(pdf, x + WIDTH - badgeWidth - 14, top + 21, badgeWidth, 28, 7, PALETTE.purple);
  pdf.fillColor("#e8e4ff").font("Helvetica-Bold").fontSize(8)
    .text(badge, x + WIDTH - badgeWidth - 14, top + 31, { width: badgeWidth, align: "center", lineBreak: false });

  pdf.fillColor(PALETTE.ink).font("Helvetica-Bold").fontSize(18)
    .text(report.title, x, top + boxHeight + 15, { width: WIDTH });
  pdf.fillColor(PALETTE.muted).font("Helvetica").fontSize(9)
    .text(`${dateText(report.from)} — ${dateText(report.to)}`, x, pdf.y + 4, { width: WIDTH });

  const infoY = pdf.y + 12;
  roundRect(pdf, x, infoY, WIDTH, 43, 7, PALETTE.surface);
  pdf.fillColor(PALETTE.ink).font("Helvetica-Bold").fontSize(8)
    .text(report.accountName, x + 12, infoY + 8, { width: 190, lineBreak: false });
  pdf.fillColor(PALETTE.muted).font("Helvetica").fontSize(7)
    .text(`Owner: ${report.ownerName}${report.ownerEmail ? `  ·  ${report.ownerEmail}` : ""}`, x + 12, infoY + 23, { width: WIDTH - 24, lineBreak: false });
  pdf.fillColor(PALETTE.muted).font("Helvetica").fontSize(7)
    .text(`Generated ${dateText(report.generatedAt)}  ·  Ref ${report.reference}`, x + WIDTH - 205, infoY + 8, {
      width: 193,
      align: "right",
      lineBreak: false,
    });
  pdf.y = infoY + 43;
}

function drawSectionHeading(pdf, title, y, options = {}) {
  const x = PAGE_MARGIN;
  const needed = 25;
  if (y + needed > PAGE_BOTTOM) {
    pdf.addPage();
    y = 38;
  }
  pdf.fillColor(PALETTE.ink).font("Helvetica-Bold").fontSize(options.size || 11)
    .text(title, x, y + 4, { width: WIDTH });
  pdf.moveTo(x, y + 21).lineTo(x + WIDTH, y + 21).lineWidth(0.7).strokeColor(PALETTE.border).stroke();
  return y + 28;
}

function drawSummaryCards(pdf, cards, y) {
  const gap = 8;
  const columns = 3;
  const cardWidth = (WIDTH - gap * (columns - 1)) / columns;
  const cardHeight = 56;
  for (let index = 0; index < cards.length; index += columns) {
    if (y + cardHeight > PAGE_BOTTOM) {
      pdf.addPage();
      y = 40;
    }
    const row = cards.slice(index, index + columns);
    row.forEach((card, column) => {
      const x = PAGE_MARGIN + column * (cardWidth + gap);
      roundRect(pdf, x, y, cardWidth, cardHeight, 7, PALETTE.surface);
      roundRect(pdf, x, y, 3, cardHeight, 2, card.accent || PALETTE.lavender);
      pdf.fillColor(PALETTE.muted).font("Helvetica").fontSize(7.5)
        .text(card.label, x + 11, y + 10, { width: cardWidth - 19, lineBreak: false });
      pdf.fillColor(card.valueColor || PALETTE.ink).font("Helvetica-Bold").fontSize(11)
        .text(formatMoney(card.value), x + 11, y + 29, { width: cardWidth - 19, lineBreak: false });
    });
    y += cardHeight + gap;
  }
  return y;
}

function transactionType(kind) {
  if (kind === "income") return { label: "CREDIT", color: PALETTE.green, fill: PALETTE.greenBg, sign: 1 };
  if (kind === "withdrawal") return { label: "WITHDRAW", color: PALETTE.amber, fill: PALETTE.amberBg, sign: -1 };
  return { label: "DEBIT", color: PALETTE.red, fill: PALETTE.redBg, sign: -1 };
}

const TRANSACTION_COLUMNS = [
  { key: "date", label: "DATE", width: 49, align: "left" },
  { key: "kind", label: "TYPE", width: 57, align: "left" },
  { key: "title", label: "DESCRIPTION", width: 112, align: "left" },
  { key: "details", label: "DETAILS", width: 103, align: "left" },
  { key: "amount", label: "AMOUNT", width: 82, align: "right" },
  { key: "balance", label: "BALANCE", width: 100, align: "right" },
];

function drawTableHeader(pdf, y, columns) {
  const x = PAGE_MARGIN;
  const height = 25;
  roundRect(pdf, x, y, WIDTH, height, 5, PALETTE.purple);
  let left = x;
  for (const column of columns) {
    pdf.fillColor("#f6f3ff").font("Helvetica-Bold").fontSize(6.5)
      .text(column.label, left + 6, y + 9, { width: column.width - 12, align: column.align || "left", lineBreak: false });
    left += column.width;
  }
  return y + height;
}

function drawTransactionTable(pdf, transactions, openingBalance, startY) {
  const columns = TRANSACTION_COLUMNS;
  let y = drawTableHeader(pdf, startY, columns);
  let running = Number(openingBalance);
  let stripe = false;
  for (const transaction of transactions) {
    const kind = transactionType(transaction.kind);
    const amount = Number(transaction.amount);
    running += kind.sign * amount;
    const details = [transaction.counterparty, transaction.category, transaction.method].filter(Boolean).join(" · ") || "—";
    const cells = [
      dateText(transaction.happenedAt),
      kind.label,
      transaction.title || "—",
      details,
      formatMoney(amount),
      formatMoney(running),
    ];
    const heights = columns.map((column, index) => textHeight(
      pdf,
      cells[index],
      column.width - 12,
      7,
      index === 4 || index === 5 ? "Helvetica-Bold" : "Helvetica",
    ));
    const rowHeight = Math.max(25, ...heights.map((height) => height + 12));
    if (y + rowHeight > PAGE_BOTTOM) {
      pdf.addPage();
      y = drawTableHeader(pdf, 38, columns);
      stripe = false;
    }
    const rowFill = stripe ? "#f8f7fc" : PALETTE.white;
    pdf.rect(PAGE_MARGIN, y, WIDTH, rowHeight).fill(rowFill);
    pdf.rect(PAGE_MARGIN, y, 3, rowHeight).fill(kind.color);
    let left = PAGE_MARGIN;
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      let color = PALETTE.ink;
      let font = "Helvetica";
      if (index === 1) {
        color = kind.color;
        font = "Helvetica-Bold";
      } else if (index === 4 || index === 5) {
        font = "Helvetica-Bold";
        if (index === 4) color = kind.color;
      }
      pdf.fillColor(color).font(font).fontSize(7)
        .text(cells[index], left + 6, y + 6, {
          width: column.width - 12,
          height: rowHeight - 10,
          align: column.align,
          lineGap: 1.5,
        });
      left += column.width;
    }
    pdf.moveTo(PAGE_MARGIN, y + rowHeight).lineTo(PAGE_MARGIN + WIDTH, y + rowHeight)
      .lineWidth(0.45).strokeColor(PALETTE.border).stroke();
    y += rowHeight;
    stripe = !stripe;
  }
  if (!transactions.length) {
    pdf.rect(PAGE_MARGIN, y, WIDTH, 38).fill(PALETTE.surface);
    pdf.fillColor(PALETTE.muted).font("Helvetica").fontSize(8)
      .text("No posted transactions for this period.", PAGE_MARGIN + 10, y + 14, { width: WIDTH - 20, align: "center" });
    y += 38;
  }
  return y;
}

function drawBillsTable(pdf, bills, total, title, startY) {
  let y = drawSectionHeading(pdf, title, startY);
  if (!bills.length) {
    roundRect(pdf, PAGE_MARGIN, y, WIDTH, 38, 6, PALETTE.surface);
    pdf.fillColor(PALETTE.muted).font("Helvetica").fontSize(8)
      .text("No unpaid scheduled bills are due in this period.", PAGE_MARGIN + 10, y + 14, { width: WIDTH - 20 });
    return y + 48;
  }
  const columns = [
    { label: "DUE DATE", width: 74 },
    { label: "BILL", width: 188 },
    { label: "RECIPIENT", width: 150 },
    { label: "AMOUNT", width: 91, align: "right" },
  ];
  y = drawTableHeader(pdf, y, columns);
  bills.forEach((bill, index) => {
    const height = Math.max(24, textHeight(pdf, bill.name, columns[1].width - 12, 7) + 12);
    if (y + height > PAGE_BOTTOM) {
      pdf.addPage();
      y = drawTableHeader(pdf, 38, columns);
    }
    pdf.rect(PAGE_MARGIN, y, WIDTH, height).fill(index % 2 ? "#f8f7fc" : PALETTE.white);
    const cells = [dateText(bill.dueDate), bill.name, bill.recipient || "—", formatMoney(bill.amount)];
    let left = PAGE_MARGIN;
    cells.forEach((cell, cellIndex) => {
      const column = columns[cellIndex];
      pdf.fillColor(cellIndex === 3 ? PALETTE.amber : PALETTE.ink)
        .font(cellIndex === 3 ? "Helvetica-Bold" : "Helvetica").fontSize(7)
        .text(cell, left + 6, y + 7, { width: column.width - 12, height: height - 8, align: column.align || "left" });
      left += column.width;
    });
    pdf.moveTo(PAGE_MARGIN, y + height).lineTo(PAGE_MARGIN + WIDTH, y + height)
      .lineWidth(0.45).strokeColor(PALETTE.border).stroke();
    y += height;
  });
  if (y + 26 > PAGE_BOTTOM) {
    pdf.addPage();
    y = 42;
  }
  roundRect(pdf, PAGE_MARGIN, y + 6, WIDTH, 27, 5, PALETTE.amberBg);
  pdf.fillColor(PALETTE.amber).font("Helvetica-Bold").fontSize(8)
    .text(`UPCOMING BILLS TOTAL  ${formatMoney(total)}`, PAGE_MARGIN + 10, y + 15, { width: WIDTH - 20, align: "right" });
  return y + 40;
}

function drawPageFooters(pdf, report) {
  const range = pdf.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    pdf.switchToPage(page);
    const y = pdf.page.height - 72;
    pdf.moveTo(PAGE_MARGIN, y - 7).lineTo(PAGE_MARGIN + WIDTH, y - 7)
      .lineWidth(0.6).strokeColor(PALETTE.border).stroke();
    pdf.fillColor(PALETTE.ink).font("Helvetica-Bold").fontSize(7)
      .text("Developed By Raviteja Kolluru", PAGE_MARGIN, y, { width: 250, lineBreak: false });
    pdf.fillColor(PALETTE.muted).font("Helvetica").fontSize(7)
      .text(`${report.reference}  ·  Page ${page - range.start + 1} of ${range.count}`, PAGE_MARGIN + 255, y, {
        width: WIDTH - 255,
        align: "right",
        lineBreak: false,
      });
    pdf.fillColor(PALETTE.muted).font("Helvetica").fontSize(6.5)
      .text("RTIGO: R = Rupees  ·  T = Track  ·  I = Insights  ·  GO = Growth & Organization", PAGE_MARGIN, y + 10, {
        width: WIDTH,
        lineBreak: false,
      });
  }
}

function createFinancialPdf(report, { password } = {}) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: 32, bottom: 48, left: PAGE_MARGIN, right: PAGE_MARGIN },
      bufferPages: true,
      ...(password ? {
        userPassword: password,
        ownerPassword: crypto.randomBytes(24).toString("hex"),
      } : {}),
    });
    const chunks = [];
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.once("error", reject);
    pdf.once("end", () => resolve(Buffer.concat(chunks)));

    drawPageHeader(pdf, report);
    let y = pdf.y + 12;
    y = drawSummaryCards(pdf, report.summary, y);
    if (report.bills) {
      y = drawBillsTable(pdf, report.bills, report.billsTotal, report.billsTitle, y + 4);
    }
    y = drawSectionHeading(pdf, "TRANSACTIONS", y + 4);
    drawTransactionTable(pdf, report.transactions, report.openingBalance, y);
    drawPageFooters(pdf, report);
    pdf.end();
  });
}

module.exports = { createFinancialPdf, dateText, formatMoney };
