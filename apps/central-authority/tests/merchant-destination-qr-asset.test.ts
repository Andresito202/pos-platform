import {describe,expect,it} from "vitest";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
import {validateOfficialQrPng} from "../src/merchant-destination-qr-asset.js";
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const table=Array.from({length:256},(_,n)=>{
 let c=n;
 for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
 return c>>>0;
});
function crc32(b:Buffer){
 let c=0xffffffff;
 for(const byte of b)c=table[(c^byte)&255]!^(c>>>8);
 return(c^0xffffffff)>>>0;
}
function chunk(type:string,data:Buffer){
 const head=Buffer.alloc(8);head.writeUInt32BE(data.length,0);head.write(type,4,"ascii");
 const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type),data])),0);
 return Buffer.concat([head,data,crc]);
}
function png(width=2,height=2,metadata=false){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
 ihdr[8]=8;ihdr[9]=6;
 const scan=Buffer.alloc(height*(1+width*4));
 const bytes=[signature,chunk("IHDR",ihdr)];
 if(metadata)bytes.push(chunk("tEXt",Buffer.from("bank=spoofed")));
 bytes.push(chunk("IDAT",deflateSync(scan)),chunk("IEND",Buffer.alloc(0)));
 return Buffer.concat(bytes);
}
describe("QR-001 official PNG ingress",()=>{
 it("accepts narrowly supported PNG and returns exact SHA-256",()=>{
  const bytes=png(),result=validateOfficialQrPng(bytes);
  expect(result.contentType).toBe("image/png");
  expect(result.width).toBe(2);expect(result.height).toBe(2);
  expect(result.bytes.equals(bytes)).toBe(true);
  expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
 });
 it("rejects untrusted metadata, trailing bytes and corrupt CRC",()=>{
  expect(()=>validateOfficialQrPng(png(2,2,true))).toThrow("INVALID_OFFICIAL_QR_PNG");
  expect(()=>validateOfficialQrPng(Buffer.concat([png(),Buffer.from("extra")]))).toThrow();
  const tampered=Buffer.from(png());tampered[30]^=1;
  expect(()=>validateOfficialQrPng(tampered)).toThrow();
 });
 it("rejects oversized dimensions and decompression beyond declared dimensions",()=>{
  expect(()=>validateOfficialQrPng(png(1025,1))).toThrow();
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
  const overlong=Buffer.concat([signature,chunk("IHDR",ihdr),
    chunk("IDAT",deflateSync(Buffer.alloc(1024*1024))),
    chunk("IEND",Buffer.alloc(0))]);
  expect(()=>validateOfficialQrPng(overlong)).toThrow();
 });
 it("rejects non-image data, truncated PNG and invalid scanline filters",()=>{
  expect(()=>validateOfficialQrPng(Buffer.from("<svg/>"))).toThrow();
  expect(()=>validateOfficialQrPng(png().subarray(0,60))).toThrow();
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
  const invalid=Buffer.concat([signature,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(Buffer.from([5,0,0,0,0]))),chunk("IEND",Buffer.alloc(0))]);
  expect(()=>validateOfficialQrPng(invalid)).toThrow();
 });
});
