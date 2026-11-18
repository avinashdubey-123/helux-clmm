#!/usr/bin/env node
/**
 * Attaches Metaplex Token Metadata (name / symbol / uri) to an existing
 * classic SPL Token mint. Dev/test helper - not part of the app bundle.
 *
 * Usage (from the repo root; use ../scripts/... when inside frontend/):
 *   node scripts/create-metaplex-metadata.mjs <MINT> "<NAME>" "<SYMBOL>" "<URI>"
 *
 * Env:
 *   RPC_URL  - defaults to https://api.devnet.solana.com
 *   KEYPAIR  - defaults to the keypair in your Solana CLI config
 *              (must be the mint authority of <MINT>; it also pays)
 *   DRY_RUN=1 - simulate only, send nothing
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// Dependencies live in frontend/node_modules (the repo root has no package.json),
// so resolve @solana/web3.js from there.
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const CREATE_METADATA_ACCOUNT_V3 = 33;
const LIMITS = { name: 32, symbol: 10, uri: 200 };

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: node scripts/create-metaplex-metadata.mjs <MINT> "<NAME>" "<SYMBOL>" "<URI>"');
  process.exit(1);
}

function cliKeypairPath() {
  try {
    const config = fs.readFileSync(path.join(os.homedir(), ".config/solana/cli/config.yml"), "utf8");
    const match = config.match(/^keypair_path:\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    // fall through to the default path
  }
  return path.join(os.homedir(), ".config/solana/id.json");
}

/** Borsh string: u32 little-endian byte length + UTF-8 bytes. */
function borshString(value) {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function buildCreateMetadataIx({ mint, authority, payer, name, symbol, uri }) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_ID,
  );

  const data = Buffer.concat([
    Buffer.from([CREATE_METADATA_ACCOUNT_V3]),
    // DataV2
    borshString(name),
    borshString(symbol),
    borshString(uri),
    Buffer.from([0, 0]), // seller_fee_basis_points: u16 = 0
    Buffer.from([0]), // creators: None
    Buffer.from([0]), // collection: None
    Buffer.from([0]), // uses: None
    // CreateMetadataAccountArgsV3
    Buffer.from([1]), // is_mutable: true
    Buffer.from([0]), // collection_details: None
  ]);

  const ix = new TransactionInstruction({
    programId: METAPLEX_PROGRAM_ID,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false }, // mint authority
      { pubkey: payer, isSigner: true, isWritable: true }, // payer
      { pubkey: authority, isSigner: false, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { ix, metadata };
}

async function main() {
  const [mintArg, name, symbol, uri] = process.argv.slice(2);
  if (!mintArg || !name || !symbol || !uri) usage();
  for (const [field, value] of Object.entries({ name, symbol, uri })) {
    if (Buffer.byteLength(value, "utf8") > LIMITS[field]) {
      usage(`${field} must be at most ${LIMITS[field]} bytes`);
    }
  }

  let mint;
  try {
    mint = new PublicKey(mintArg);
  } catch {
    usage("invalid mint address");
  }

  const keypairPath = process.env.KEYPAIR || cliKeypairPath();
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))),
  );
  const connection = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");

  const { ix, metadata } = buildCreateMetadataIx({
    mint,
    authority: signer.publicKey,
    payer: signer.publicKey,
    name,
    symbol,
    uri,
  });

  console.log(`Mint:      ${mint.toBase58()}`);
  console.log(`Metadata:  ${metadata.toBase58()}`);
  console.log(`Authority: ${signer.publicKey.toBase58()} (${keypairPath})`);

  const tx = new Transaction().add(ix);
  if (process.env.DRY_RUN) {
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(signer);
    const sim = await connection.simulateTransaction(tx);
    console.log(sim.value.err ? `Simulation failed: ${JSON.stringify(sim.value.err)}` : "Simulation OK");
    sim.value.logs?.forEach((l) => console.log("  ", l));
    return;
  }

  const signature = await sendAndConfirmTransaction(connection, tx, [signer]);
  console.log(`Done. Signature: ${signature}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
