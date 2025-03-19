const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const fs = require("fs");

// Check if private key is provided as command line argument
if (process.argv.length < 3) {
    console.error("Usage: node key-converter.js <base58_private_key>");
    process.exit(1);
}

const privateKeyPath = process.argv[2];
const base58PrivateKey = (fs.readFileSync(privateKeyPath, 'utf-8')).trim();

try {
    // Decode the base58 private key
    const privateKeyBytes = bs58.decode(base58PrivateKey);
    
    // Create a keypair from the private key
    const keypair = Keypair.fromSecretKey(privateKeyBytes);

    // write out the 32 elements of the publicKey Uint8Array to a json file
    const publicKey = Array.from(keypair.publicKey.toBytes());
    fs.writeFileSync("public_key.json", JSON.stringify(publicKey));

    // write out the 64 elements of the privateKey Uint8Array to a json file
    const privateKey = Array.from(keypair.secretKey);
    fs.writeFileSync("private_key.json", JSON.stringify(privateKey));

    console.log("Successfully converted key:");
    console.log("Public key (base58):", keypair.publicKey.toString());
    console.log("Public key written to: public_key.json");
    console.log("Private key written to: private_key.json");
    
} catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
} 