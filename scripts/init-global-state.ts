import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import type { PayaiMarketplace } from "../target/types/payai_marketplace";
import idl from "../target/idl/payai_marketplace.json";
import fs from "fs";

// Program ID from Anchor.toml
const PROGRAM_ID = new PublicKey("5FhmaXvWm1FZ3bpsE5rxkey5pNWDLkvaGAzoGkTUZfZ3");

// get the cluster url from the first argument
const clusterUrl = process.argv[2];

// get the path to the private key from the second argument
// and read the private key from the file
const privateKeyPath = process.argv[3];
const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
const wallet = new anchor.Wallet(Keypair.fromSecretKey(new Uint8Array(JSON.parse(privateKey))));
console.log("wallet: ", wallet)

// Initialize connection to local cluster
const connection = new Connection(clusterUrl, "confirmed");

// Create provider from connection and wallet
const provider = new AnchorProvider(
  connection,
  wallet,
  { commitment: "confirmed" }
);

// Create program interface
const program = new Program(idl as PayaiMarketplace, provider);

async function main() {
  try {
    await program.methods.initializeGlobalState().rpc();
    
    console.log("Global state initialized successfully");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();