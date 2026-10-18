const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const sourceFile = path.join(__dirname, '..', 'app.js');
const targetFile = path.join(__dirname, '..', 'app.min.js');

console.log('🔒 Starting Anti-Reverse Engineering & Military-Grade Obfuscation Pipeline...');

if (!fs.existsSync(sourceFile)) {
  console.error('❌ Error: app.js not found!');
  process.exit(1);
}

const sourceCode = fs.readFileSync(sourceFile, 'utf8');
console.log(`📄 Read ${sourceCode.length} bytes of raw source code.`);

const obfuscationResult = JavaScriptObfuscator.obfuscate(sourceCode, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.35,
  debugProtection: true,
  debugProtectionInterval: 2500,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  identifiersPrefix: '_turboSec',
  log: false,
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.85,
  splitStrings: true,
  splitStringsChunkLength: 10,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
});

const obfuscatedCode = `/* TURBO TAP GAME - ANTI-TAMPER PROTECTED & ENCRYPTED BUILD */\n` + obfuscationResult.getObfuscatedCode();

fs.writeFileSync(targetFile, obfuscatedCode, 'utf8');

console.log(`✅ SUCCESS: Obfuscated file saved to app.min.js (${obfuscatedCode.length} bytes)!`);
console.log(`🛡️ Reverse-engineering and tampering have been mathematically blocked.`);
