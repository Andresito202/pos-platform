import { generateKeyPairSync, sign } from "node:crypto";

/** Ephemeral, self-signed loopback certificate for transport tests only.
 * No stored private key, system trust change or production TLS bypass. */
export function businessTestTls() {
  const der = (tag: number, ...items: Buffer[]): Buffer => {
    const payload = Buffer.concat(items), n = payload.length;
    const length = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81,n]) : Buffer.from([0x82,n >> 8,n & 255]);
    return Buffer.concat([Buffer.from([tag]),length,payload]);
  };
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const algorithm = Buffer.from("300d06092a864886f70d01010b0500", "hex");
  const name = der(0x30,der(0x31,der(0x30,Buffer.from("0603550403","hex"),der(0x0c,Buffer.from("localhost")))));
  const validity = der(0x30,der(0x17,Buffer.from("200101000000Z")),der(0x17,Buffer.from("400101000000Z")));
  const san = der(0x30,Buffer.from("0603551d11","hex"),der(0x04,der(0x30,der(0x87,Buffer.from([127,0,0,1])),der(0x82,Buffer.from("localhost")))));
  const tbs = der(0x30,der(0xa0,der(0x02,Buffer.from([2]))),der(0x02,Buffer.from([1])),algorithm,name,validity,name,
    pair.publicKey.export({ type: "spki", format: "der" }),der(0xa3,der(0x30,san)));
  const certificate = der(0x30,tbs,algorithm,der(0x03,Buffer.from([0]),sign("sha256",tbs,pair.privateKey)));
  const cert = "-----BEGIN CERTIFICATE-----\n" + certificate.toString("base64").match(/.{1,64}/g)!.join("\n") + "\n-----END CERTIFICATE-----\n";
  return { key: pair.privateKey.export({ type: "pkcs8", format: "pem" }), cert };
}
