import {createHash} from "node:crypto";
import {inflateSync} from "node:zlib";

/**
 * QR-001: server-side validation of merchant-supplied official static PNG.
 * Not a QR generator and never evidence that a transfer was settled.
 *
 * Initial supported image profile: PNG 8-bit RGB/RGBA, non-interlaced, with
 * IHDR, one-or-more contiguous IDAT, IEND. Ancillary chunks, APNG, palette,
 * ICC/EXIF and trailing bytes are rejected instead of retained. A subsequent
 * private object store must persist the ORIGINAL validated bytes atomically.
 *
 * Validation is a gate, NOT malware scanning or proof of bank ownership.
 */
const MAX_FILE_BYTES=1_048_576;
const MAX_EDGE=1024;
const MAX_DECOMPRESSED=4_195_328;
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CRC_TABLE=new Uint32Array(256);
for(let n=0;n<256;n++){
 let c=n;
 for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
 CRC_TABLE[n]=c>>>0;
}
function crc32(bytes:Buffer):number{
 let c=0xffffffff;
 for(const byte of bytes)c=CRC_TABLE[(c^byte)&255]!^(c>>>8);
 return (c^0xffffffff)>>>0;
}
function fail():never{throw new Error("INVALID_OFFICIAL_QR_PNG");}
export interface VerifiedOfficialQrPng {
 readonly bytes:Buffer;
 readonly sha256:string;
 readonly width:number;
 readonly height:number;
 readonly contentType:"image/png";
}
export function validateOfficialQrPng(input:Buffer):VerifiedOfficialQrPng {
 if(!Buffer.isBuffer(input)||input.length<57||input.length>MAX_FILE_BYTES||
    !input.subarray(0,8).equals(PNG_SIGNATURE))return fail();
 let pos=8,width=0,height=0,channels=0;
 let phase:"BEGIN"|"IMAGE"|"END"="BEGIN";
 const compressed:Buffer[]=[];
 let compressedTotal=0;
 while(pos<input.length){
   if(input.length-pos<12)return fail();
   const length=input.readUInt32BE(pos);
   if(length>MAX_FILE_BYTES||length>input.length-pos-12)return fail();
   const type=input.toString("ascii",pos+4,pos+8);
   if(!/^[A-Za-z]{4}$/.test(type))return fail();
   const dataStart=pos+8;
   const dataEnd=dataStart+length;
   const actual=input.readUInt32BE(dataEnd);
   if(crc32(input.subarray(pos+4,dataEnd))!==actual)return fail();
   if(type==="IHDR"){
     if(phase!=="BEGIN"||length!==13)return fail();
     width=input.readUInt32BE(dataStart);
     height=input.readUInt32BE(dataStart+4);
     const bitDepth=input[dataStart+8];
     const colorType=input[dataStart+9];
     if(width<1||height<1||width>MAX_EDGE||height>MAX_EDGE||
       bitDepth!==8||(colorType!==2&&colorType!==6)||
       input[dataStart+10]!==0||input[dataStart+11]!==0||input[dataStart+12]!==0)return fail();
     channels=colorType===2?3:4;
     phase="IMAGE";
   }else if(type==="IDAT"){
     if(phase!=="IMAGE"||compressedTotal+length>MAX_FILE_BYTES)return fail();
     compressed.push(input.subarray(dataStart,dataEnd));
     compressedTotal+=length;
   }else if(type==="IEND"){
     if(phase!=="IMAGE"||length!==0||compressed.length===0||dataEnd+4!==input.length)return fail();
     phase="END";
   }else{return fail();}
   pos=dataEnd+4;
 }
 if(phase!=="END")return fail();
 const expected=height*(width*channels+1);
 if(expected>MAX_DECOMPRESSED)return fail();
 let raw:Buffer;
 try {raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});}
 catch{return fail();}
 if(raw.length!==expected)return fail();
 const stride=width*channels+1;
 for(let row=0;row<height;row++)if(raw[row*stride]!>4)return fail();
 return {
   bytes:Buffer.from(input),
   sha256:createHash("sha256").update(input).digest("hex"),
   width,height,contentType:"image/png",
 };
}
