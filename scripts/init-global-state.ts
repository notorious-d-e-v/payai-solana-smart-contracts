import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import type { PayaiMarketplace } from "../target/types/payai_marketplace";
import idl from "../target/idl/payai_marketplace.json";

// Program ID from Anchor.toml
const PROGRAM_ID = new PublicKey("EVD9NPX2LVrnxuHHRNzTB9rz6a9dmh1LNQvTuJNLm3R1");

// Initialize connection to local cluster
const connection = new Connection("http://localhost:8899", "confirmed");

// Create provider from connection and wallet
const provider = new AnchorProvider(
  connection,
  new anchor.Wallet(Keypair.generate()), // Replace with actual wallet
  { commitment: "confirmed" }
);

// Create program interface
const program = new Program(idl as PayaiMarketplace);

async function main() {
  try {
    await program.methods.initializeGlobalState().rpc();
    
    console.log("Global state initialized successfully");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();