import type { HardwareProfile } from "@pos-platform/contracts";
import type { Receipt } from "../receipts/receipt.js";

/** Formats persisted scale-6 strings without floating point or recalculation. */
export function formatReceiptAmount(value:string):string {
  if(!/^-?\d+\.\d{6}$/.test(value))throw new Error("RECEIPT_AMOUNT_INVALID");
  const [whole,fraction]=value.split(".");
  const decimals=fraction!.replace(/0+$/,"");
  return whole!.replace(/\B(?=(\d{3})+(?!\d))/g,".")+(decimals?","+decimals:"");
}
/** No fiscal identity invented; all monetary values come from DEC-019 projection. */
export function projectPrintableReceipt(receipt:Receipt,columns:number):string {
  const lines=["RECIBO COMERCIAL",`${receipt.documentSeries}-${receipt.saleNumber}`,receipt.businessDate,"Sin validación fiscal"];
  for(const item of receipt.lines)lines.push(item.productName,`${item.quantity} ${item.unitCode}  ${formatReceiptAmount(item.lineTotalAmount)}`);
  lines.push(`Subtotal ${formatReceiptAmount(receipt.subtotalAmount)}`,`Descuento ${formatReceiptAmount(receipt.discountAmount)}`,
    `Impuesto ${formatReceiptAmount(receipt.taxAmount)}`,`Redondeo ${formatReceiptAmount(receipt.commercialRoundingAdjustment)}`,
    `TOTAL ${receipt.currencyCode} ${formatReceiptAmount(receipt.payableAmount)}`);
  for(const payment of receipt.payments)lines.push(`${payment.paymentMethod} ${formatReceiptAmount(payment.confirmedAmount)}`);
  // Reject ESC/control injection from product snapshots before transport.
  if(lines.some(line=>/[\x00-\x1f\x7f]/.test(line)))throw new Error("HARDWARE_TEXT_CONTAINS_CONTROL");
  return lines.flatMap(line=>Array.from({length:Math.max(1,Math.ceil(line.length/columns))},(_,i)=>line.slice(i*columns,(i+1)*columns))).join("\n")+"\n\n";
}
const cp1252Extras="€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
export function encodePrinterText(text:string,profile:HardwareProfile):Uint8Array {
  if(profile.protocol!=="ESC_POS")throw new Error("PRINTER_REQUIRES_VENDOR_ADAPTER");
  const bytes:number[]=[0x1b,0x74,profile.code_page];
  for(const char of text){
    const code=char.codePointAt(0)!;
    if(code===10){bytes.push(10);continue;}
    if(code<32 || (code>=127&&code<=159))throw new Error("HARDWARE_TEXT_CONTAINS_CONTROL");
    if(code<=255){bytes.push(code);continue;}
    const index=cp1252Extras.indexOf(char);if(index<0)throw new Error("PRINTER_CHARACTER_UNSUPPORTED");
    bytes.push(128+index);
  }
  return Uint8Array.from(bytes);
}
export function drawerPulse(profile:HardwareProfile):Uint8Array {
  if(profile.protocol!=="ESC_POS" || profile.drawer!=="SUPPORTED" || !profile.drawer_pulse)throw new Error("DRAWER_PROFILE_UNSUPPORTED");
  return Uint8Array.from([0x1b,0x70,profile.drawer_pulse.pin,profile.drawer_pulse.on,profile.drawer_pulse.off]);
}
export function cutterCommand(profile:HardwareProfile):Uint8Array {
  if(profile.cut!=="SUPPORTED"||!profile.cut_command)throw new Error("PRINTER_HAS_NO_VERIFIED_CUTTER");
  return Uint8Array.from([0x1d,0x56,profile.cut_command==="GS_V_0"?0:1]);
}
