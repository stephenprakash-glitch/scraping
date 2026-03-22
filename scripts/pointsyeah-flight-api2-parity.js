#!/usr/bin/env node
/**
 * Validates encryptCreateTaskBody envelope sizes (AES-GCM + RSA-2048-OAEP).
 * Does not call api2 (needs real PointsYeah public key + JWT for that).
 *
 * Run: node scripts/pointsyeah-flight-api2-parity.js
 */

const crypto = require("crypto");
const { encryptCreateTaskBody } = require("../src/lib/pointsYeahFlightApi2");

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

const sample = {
  departure: "CJB",
  arrival: "MAA",
  departDate: "2026-03-28",
  cabin: "Economy",
  tripType: "1",
  adults: "1",
  children: "0"
};

const { data, encrypted } = encryptCreateTaskBody(sample, publicKey);
const dataBuf = Buffer.from(data, "base64");
const encBuf = Buffer.from(encrypted, "base64");

if (encBuf.length !== 256) {
  console.error("FAIL: encrypted length", encBuf.length);
  process.exit(1);
}

const aesKey = crypto.privateDecrypt(
  {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256"
  },
  encBuf
);

if (aesKey.length !== 32) {
  console.error("FAIL: recovered AES key length", aesKey.length);
  process.exit(1);
}

const iv = dataBuf.subarray(0, 12);
const tag = dataBuf.subarray(dataBuf.length - 16);
const ciphertext = dataBuf.subarray(12, dataBuf.length - 16);
const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv, { authTagLength: 16 });
decipher.setAuthTag(tag);
const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
const parsed = JSON.parse(plain);

if (parsed.departure !== sample.departure) {
  console.error("FAIL roundtrip JSON", parsed);
  process.exit(1);
}

console.log("OK encrypt roundtrip");
console.log("  data (base64 len):", data.length, "decoded bytes:", dataBuf.length);
console.log("  encrypted decoded bytes:", encBuf.length, "(expect 256 for RSA-2048)");
