import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** A small multi-page document used for the "Try a sample" button and tests. */
export async function makeSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);

  const p1 = doc.addPage([612, 792]);
  p1.drawText('Service Agreement', { x: 72, y: 700, size: 26, font: bold, color: rgb(0.1, 0.1, 0.2) });
  p1.drawText('Client: Acme Corporation', { x: 72, y: 660, size: 13, font: helv });
  p1.drawText('Account number: 4417-2290-1138', { x: 72, y: 640, size: 13, font: helv });
  const body = [
    'This agreement describes the services that the provider will deliver to',
    'the client during the contract period. Payment is due within 30 days of',
    'the invoice date. Either party may end this agreement with written notice.',
  ];
  body.forEach((l, i) => p1.drawText(l, { x: 72, y: 590 - i * 20, size: 12, font: times }));
  p1.drawText('Signature: ______________________', { x: 72, y: 180, size: 12, font: helv });
  p1.drawRectangle({ x: 72, y: 380, width: 468, height: 120, borderColor: rgb(0.18, 0.42, 0.31), borderWidth: 1.5 });
  p1.drawText('Total due: $12,400.00', { x: 90, y: 440, size: 16, font: bold });

  const p2 = doc.addPage([612, 792]);
  p2.drawText('Page two: Terms and conditions', { x: 72, y: 700, size: 20, font: bold });
  p2.drawText('Confidential information must not be shared with third parties.', { x: 72, y: 660, size: 12, font: helv });

  const p3 = doc.addPage([792, 612]);
  p3.drawText('Page three: landscape appendix', { x: 72, y: 540, size: 20, font: bold });

  doc.setTitle('Sample agreement');
  return doc.save();
}
